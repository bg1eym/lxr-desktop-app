/*
 * LXR-02 Emu (unofficial) - replaces Core/Src/main.c and stm32f7xx_it.c.
 *
 * Boot follows main() step by step. After that, the emulator has a single
 * clock, the number of rendered samples. For every 64-frame block it runs
 * what the hardware runs during that time: the TIM14 handler (0.25 ms
 * "systick", menu ticks), the 1 ms SysTick handler, the I2S DMA half-transfer
 * that asks for the next block, and one pass of the main loop, which renders
 * the block. Rates are the hardware's exact clock ratios, so the sample
 * stream matches the device sample for sample; only the playback rate
 * differs (44100 Hz instead of 44140.625 Hz, 0.09 % slower).
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "main.h"
#include "fatfs.h"
#include "lcd.h"
#include "menu/menu.h"
#include "IO/DIO.h"
#include "menu/screensaver.h"
#include "menu/copyClearTools.h"
#include "ledHandler.h"
#include "buttonHandler.h"
#include "encoder.h"
#include "IO/adcPots.h"
#include "Preset/PresetManager.h"
#include "Soundengine/Soundengine.h"
#include "Soundengine/globals.h"
#include "Soundengine/cs4344_cs5343.h"
#include "Soundengine/AudioCodecManager.h"
#include "Soundengine/DSPAudio/random.h"
#include "Soundengine/USB/usb_manager.h"
#include "Soundengine/MIDI/Uart.h"
#include "Soundengine/MIDI/MidiParser.h"
#include "Soundengine/Sequencer/sequencer.h"

#include "emu_hw.h"
#include "platform.h"

/* ---- globals that main.c and stm32f7xx_it.c define ----------------------- */
ADC_HandleTypeDef hadc1;
I2S_HandleTypeDef hi2s2;
I2S_HandleTypeDef hi2s3;
RNG_HandleTypeDef hrng;
SPI_HandleTypeDef hspi1;
TIM_HandleTypeDef htim2;
TIM_HandleTypeDef htim14;
UART_HandleTypeDef huart3;
float debugWatch = 0;
volatile uint32_t systick_ticks;

extern uint16_t adc_buf_old[ADC_BUF_LEN];  /* IO/adcPots.c, not in its header */

static TIM_TypeDef tim2_regs, tim14_regs;
static SPI_TypeDef spi1_regs;

/* ---- clock ratios ------------------------------------------------------------
 * I2S: PLLI2S 113 MHz / R 5 = 22.6 MHz, MCLK on, I2SDIV 1 -> fs = 22.6 MHz / 512
 *      = 44140.625 Hz (see REAL_FS in Soundengine/config.h).
 * TIM14: 108 MHz / (13500+1) / (1+1) = 3999.70 Hz.
 * SysTick: 1000 Hz.
 * Counted in integer units so the schedule never drifts:
 *   samples per TIM14 tick = 3051226 / 276480, samples per ms = 113000 / 2560. */
#define TIM14_NUM 3051226u
#define TIM14_DEN 276480u
#define MS_NUM    113000u
#define MS_DEN    2560u

static uint64_t tim14_acc, ms_acc;
static uint32_t emu_ms_count;
static uint64_t samples_rendered;
static uint8_t dma_half;
static uint8_t sd_card_ok;
static uint8_t lastSdState;

void emu_fatal(const char *msg)
{
	fprintf(stderr, "lxr-emu: fatal: %s\n", msg);
	abort();
}

/* ---- audio codec ------------------------------------------------------------
 * Replaces AudioCodecManager.c and cs4344_cs5343.c: same DMA double buffers
 * and sample flag, the DMA itself is modelled in emu_render_block().
 * CodecInit() takes the sample rate here: Soundengine.c calls it with one
 * argument while AudioCodecManager.c defines it without parameters, which
 * WebAssembly cannot call. */
int16_t dma_buffer[OUTPUT_DMA_SIZE * 4];
int16_t dma_buffer2[OUTPUT_DMA_SIZE * 4];
volatile uint8_t bCurrentSampleValid = 0;

int CodecInit(uint32_t fs)
{
	(void)fs;
	dma_buffer[0] = 32756;   /* as in AudioCodecManager.c */
	return 0;
}

static void encoder_hw_tick(void);
static void splash_tick(void);

/* ---- interrupt handlers --------------------------------------------------- */
static void tim14_irq(void)        /* TIM8_TRG_COM_TIM14_IRQHandler */
{
	systick_ticks++;
	if (lcd_process_display_interrupt) menu_tick();
	if (lcd_process_display_interrupt) menu_tick();
	if (lcd_process_display_interrupt) menu_tick();
	if (lcd_process_display_interrupt) menu_tick();
}

static void systick_irq(void)      /* SysTick_Handler */
{
	emu_time_set_ms(++emu_ms_count);
	splash_tick();
	screensaver_timer++;
	encoder_hw_tick();
	encoder_callback();
}

/* MIDI DIN out: USART3_IRQHandler sends one byte per TXE interrupt while the
 * firmware keeps TXEIE enabled. */
static emu_midi_out_fn midi_out_cb;
static void *midi_out_user;

void emu_set_midi_out(emu_midi_out_fn fn, void *user)
{
	midi_out_cb = fn;
	midi_out_user = user;
}

static void uart_drain_tx(void)
{
	for (int guard = 0; guard < 4096 && (USART3->CR1 & UART_IT_TXE); guard++) {
		USART3->ISR = USART_ISR_TXE;
		const uint32_t before = USART3->TDR;
		USART3->TDR = 0x100;           /* marker: not written by the handler */
		USART3_IRQHandler();
		if (USART3->TDR != 0x100) {
			if (midi_out_cb) midi_out_cb((uint8_t)USART3->TDR, midi_out_user);
		} else {
			USART3->TDR = before;
		}
	}
	USART3->ISR = 0;
}

void emu_midi_in_byte(uint8_t b)
{
	USART3->ISR = USART_ISR_RXNE;
	USART3->RDR = b;
	USART3_IRQHandler();
	USART3->ISR = 0;
}

/* ---- virtual inputs ----------------------------------------------------- */
void emu_set_fader(uint8_t idx, float pos);

void emu_set_jacks(uint8_t mask)
{
	/* Jack detect switches read high when a plug is in (pull-up, the normalling
	 * contact grounds the pin when nothing is plugged). Bit 0/1: out 1 L/R,
	 * bit 2/3: out 2 L/R. */
	if (mask & 1) switch_l1_GPIO_Port->IDR |= switch_l1_Pin; else switch_l1_GPIO_Port->IDR &= ~(uint32_t)switch_l1_Pin;
	if (mask & 2) switch_r1_GPIO_Port->IDR |= switch_r1_Pin; else switch_r1_GPIO_Port->IDR &= ~(uint32_t)switch_r1_Pin;
	if (mask & 4) switch_l2_GPIO_Port->IDR |= switch_l2_Pin; else switch_l2_GPIO_Port->IDR &= ~(uint32_t)switch_l2_Pin;
	if (mask & 8) switch_r2_GPIO_Port->IDR |= switch_r2_Pin; else switch_r2_GPIO_Port->IDR &= ~(uint32_t)switch_r2_Pin;
}

/* ---- main encoder -----------------------------------------------------------
 * A/B are sampled by encoder_callback() every millisecond. One detent is a
 * full quadrature cycle (4 transitions) from the rest state 11; the pins get
 * one transition per SysTick. The switch is debounced over 4 samples 10 ms
 * apart, so every level is held for at least ENC_BTN_HOLD_MS. */
#define ENC_BTN_HOLD_MS 60
static int32_t enc_pending;            /* quarter steps still to send, sign = direction */
static uint8_t enc_state = 3;          /* A<<1 | B on the pins */
static uint8_t enc_btn_target;         /* 1 = pressed */
static uint32_t enc_btn_changed_ms;

static void enc_set_pins(uint8_t st)
{
	enc_state = st;
	if (st & 2) Enc_A_GPIO_Port->IDR |= Enc_A_Pin; else Enc_A_GPIO_Port->IDR &= ~(uint32_t)Enc_A_Pin;
	if (st & 1) Enc_B_GPIO_Port->IDR |= Enc_B_Pin; else Enc_B_GPIO_Port->IDR &= ~(uint32_t)Enc_B_Pin;
}

void emu_encoder_turn(int detents)
{
	enc_pending += detents * 4;
}

void emu_encoder_button(uint8_t down)
{
	enc_btn_target = down ? 1 : 0;
}

static void encoder_hw_tick(void)
{
	/* forward: 00 -> 01 -> 11 -> 10 -> 00 */
	static const uint8_t fwd[4] = { 1, 3, 0, 2 };
	static const uint8_t back[4] = { 2, 0, 3, 1 };
	if (enc_pending > 0) { enc_set_pins(fwd[enc_state]); enc_pending--; }
	else if (enc_pending < 0) { enc_set_pins(back[enc_state]); enc_pending++; }

	const uint8_t pressed = (Enc_Switch_GPIO_Port->IDR & Enc_Switch_Pin) == 0;
	if (pressed != enc_btn_target && emu_ms_count - enc_btn_changed_ms >= ENC_BTN_HOLD_MS) {
		if (enc_btn_target) Enc_Switch_GPIO_Port->IDR &= ~(uint32_t)Enc_Switch_Pin;
		else Enc_Switch_GPIO_Port->IDR |= Enc_Switch_Pin;
		enc_btn_changed_ms = emu_ms_count;
	}
}

/* ---- endless pots -----------------------------------------------------------
 * Each pot has two wipers on ADC channels 2i and 2i+1. calcPosition() in
 * IO/adcPots.c takes the angle from wiper b and uses wiper a only to tell the
 * two half turns apart (a above mid-scale: 0..180 degrees). adc_checkPots()
 * only looks at a pot whose wiper a moved by more than its hysteresis, so a
 * is alternated between two values in the right half on every move. The pot
 * turns in steps of POT_STEP_DEG, one step per main loop pass; a value
 * parameter moves by one per step, menu-type parameters need 8 steps, as on
 * the device. */
#define POT_STEP_DEG 2
static int32_t pot_pending[4];         /* in POT_STEP_DEG steps */
static int32_t pot_angle[4];           /* degrees, 0..359 */
static uint8_t pot_flip[4];

static void pot_write_adc(int i)
{
	const float deg = pot_angle[i] + 0.5f;  /* stay clear of truncation edges */
	uint16_t a, b;
	if (deg < 180.f) {
		a = pot_flip[i] ? 0xC00 : 0xE00;
		b = (uint16_t)(deg / 180.f * 4095.f + 0.5f);
	} else {
		a = pot_flip[i] ? 0x200 : 0x400;
		b = (uint16_t)((360.f - deg) / 180.f * 4095.f + 0.5f);
	}
	adc_buf[2 * i] = (uint16_t)(a << 4);
	adc_buf[2 * i + 1] = (uint16_t)(b << 4);
}

void emu_pot_turn(uint8_t idx, int degrees)
{
	if (idx < 4) pot_pending[idx] += degrees / POT_STEP_DEG;
}

static void pots_hw_tick(void)
{
	for (int i = 0; i < 4; i++) {
		if (!pot_pending[i]) continue;
		const int dir = pot_pending[i] > 0 ? 1 : -1;
		pot_pending[i] -= dir;
		pot_angle[i] = (pot_angle[i] + dir * POT_STEP_DEG + 360) % 360;
		pot_flip[i] ^= 1;
		pot_write_adc(i);
	}
}

static void reset_inputs(void)
{
	memset(emu_gpio, 0, sizeof(emu_gpio));
	memset(&emu_panel, 0, sizeof(emu_panel));
	/* Encoder A/B and switch idle high (pulled up, switch released). */
	enc_pending = 0;
	enc_btn_target = 0;
	enc_btn_changed_ms = 0;
	enc_set_pins(3);
	Enc_Switch_GPIO_Port->IDR |= Enc_Switch_Pin;
	/* Card inserted. */
	SD_CD_GPIO_Port->IDR |= SD_CD_Pin;
	emu_set_jacks(0x3);
	/* ADC DMA buffer: 4 endless pots as sin/cos pairs (0..7), 6 volume faders
	 * (8..13). Pots rest mid-scale, faders start fully up. */
	memset(adc_buf, 0, sizeof(adc_buf));
	memset(adc_buf_old, 0, sizeof(adc_buf_old));
	for (int i = 0; i < 4; i++) {
		pot_pending[i] = 0;
		pot_angle[i] = 90;
		pot_flip[i] = 0;
		pot_write_adc(i);
	}
	memcpy(adc_buf_old, adc_buf, 8 * sizeof(uint16_t));
	for (int i = 0; i < 6; i++) emu_set_fader((uint8_t)i, 1.f);
}

/* Volume fader of voice 0..5 (Drum 1-3, Snare, Cymbal, Hihat), 0..1. */
void emu_set_fader(uint8_t idx, float pos)
{
	if (idx >= 6) return;
	if (pos < 0.f) pos = 0.f;
	if (pos > 1.f) pos = 1.f;
	adc_buf[8 + idx] = (uint16_t)(pos * 4095.f + 0.5f) << 4;
}

/* ---- boot ----------------------------------------------------------------- */

/* The firmware's licence (NOTICE.md, GPL-3.0 section 7(c)) asks modified
 * versions to say so on the start-up screen; this one replaces the
 * "Sonic Potions / LXR2 Drums V 1.7" screen of main.c. */
#define SPLASH_MS 1500
static uint32_t splash_until_ms;

static void show_splash(void)
{
	lcd_clear();
	lcd_string("Unofficial Emu");
	lcd_setcursor(0, 2);
	lcd_string("based on fw");
	lcd_string(FIRMWARE_VERSION);
	lcd_showSplash();
}

static void splash_tick(void)
{
	if (splash_until_ms && emu_ms_count >= splash_until_ms) {
		splash_until_ms = 0;
		lcd_process_display_interrupt = 1;
		menu_repaintAll();
	}
}

/* Same steps as sd_formatRoutine() in main.c, without the two "are you sure"
 * prompts and the "please reboot" halt.
 * One difference: seq_init() runs first. On the device the routine runs
 * before the sequencer is initialised, so project 0 gets all-zero patterns,
 * including track length 0, which makes the sequencer divide by zero (ARM's
 * UDIV returns 0 there, the host traps). With seq_init() the saved patterns
 * are cleared ones, 16 steps long. */
static FRESULT format_card(void)
{
	static FATFS fs;
	BYTE work[512];
	FRESULT res = f_mkfs("", FM_FAT32, 0, work, 512);
	if (res != FR_OK) return res;
	f_mount(&fs, "", 0);
	seq_init();
	preset_createGlobals();
	preset_init(0);
	sprintf(savefileNames[0][PROJECT_NAMES], "Init");
	preset_saveProject(0);
	f_mount(0, "", 0);
	return FR_OK;
}

int emu_boot(const emu_boot_opts *opts)
{
	emu_rng_seed(opts->seed);
	reset_inputs();
	if (opts->jacks) emu_set_jacks(opts->jacks);

	htim2.Instance = &tim2_regs;
	htim14.Instance = &tim14_regs;
	hspi1.Instance = &spi1_regs;
	huart3.Instance = USART3;
	tim14_acc = ms_acc = 0;
	emu_ms_count = 0;
	emu_time_set_ms(0);
	samples_rendered = 0;
	dma_half = 0;

	/* main(): peripheral init */
	MX_FATFS_Init();
	dio_init(&hspi1);
	lcd_init();
	lcd_clear();
	lcd_home();
	menu_init();
	adc_checkPots();
	adc_checkPots();
	MX_FATFS_ReInit();

	show_splash();

	/* mount, formatting a blank card first (sd_formatRoutine) */
	sd_card_ok = 0;
	FRESULT res = f_mount((FATFS *)&SDFatFS, (TCHAR const *)SDPath, 1);
	if (res == FR_NO_FILESYSTEM && opts->format_blank_card) {
		if (format_card() != FR_OK) return -1;
		MX_FATFS_ReInit();
		res = f_mount((FATFS *)&SDFatFS, (TCHAR const *)SDPath, 1);
	}
	if (res == FR_OK) sd_card_ok = 1;
	else menu_showSdError(res);

	lcd_clear();
	adc_checkPots();
	adc_checkPots();

	sprintf(currentFolder, "/proj00");
	if (sd_card_ok) {
		FILINFO fno;
		FRESULT r = f_stat(currentFolder, &fno);
		if (r == FR_NO_FILE) {
			r = f_mkdir(currentFolder);
			if (r == FR_OK) f_chdir(currentFolder);
		} else {
			f_chdir(currentFolder);
		}
	}

	soundengine_init();

	if (sd_card_ok) {
		if (!preset_loadGlobals()) {
			lcd_clear();
			lcd_home();
			lcd_string("glo.cfg error");
			lcd_setcursor(0, 2);
			lcd_string("Using defaults.");
			preset_createGlobals();
		}
		f_chdir(currentFolder);
		morphParameters = mainParameters[0];

		for (uint8_t i = 0; i < NUM_KIT_SLOTS; i++) preset_loadProjectNames(i);
		f_chdir("/proj00");

		/* LOAD_PROJECT_ON_BOOT */
		uint8_t lastUsedProject;
		preset_loadLastUsedProjectNrFromSD(&lastUsedProject);
		preset_loadProject(lastUsedProject, 0);
		if (res != FR_OK) {
			menu_showSdError(res);
		} else {
			menu_loadedPresetNr[CURRENT_PROJECT] = menu_selectedPresetNr[SAVE_TYPE_PROJECT] = lastUsedProject;
		}
	} else {
		copyClear_clearCurrentPattern();
		preset_init(0);
		preset_loadDefaultGlobals();
	}

	initMidiUart();
	__HAL_UART_ENABLE_IT(&huart3, UART_IT_RXNE);
	HAL_TIM_Base_Start_IT(&htim14);

	lastSdState = BSP_SD_IsDetected();
	buttonHandler_init();

	preset_initTmpFolder();
	loadTmpFolderFiles();
	preset_LoadTmpKit();
	preset_LoadTmpPat();
	led_updateSeqLeds();
	preset_resetAllSaveTimers();

	/* Keep the start-up screen up for a while, as the device does with its
	 * HAL_Delay()s, then hand the display to the menu. */
	show_splash();
	lcd_process_display_interrupt = 0;   /* the preset loaders above switch it on */
	splash_until_ms = emu_ms_count + SPLASH_MS;
	return sd_card_ok ? 0 : 1;
}

/* One pass of main()'s while(1) loop. */
void emu_main_loop_iteration(void)
{
	if ((BSP_SD_IsDetected() == SD_PRESENT) && (lastSdState == SD_NOT_PRESENT)) {
		MX_FATFS_ReInit();
		f_mount(0, (TCHAR const *)SDPath, 0);
		memset((FATFS *)&SDFatFS, 0, sizeof(FATFS));
		FRESULT res = f_mount((FATFS *)&SDFatFS, (TCHAR const *)SDPath, 1);
		if (res != FR_OK) {
			menu_showSdError(res);
		} else {
			for (uint8_t i = 0; i < NUM_KIT_SLOTS; i++) preset_loadProjectNames(i);
		}
	}
	lastSdState = BSP_SD_IsDetected();

	pots_hw_tick();
	adc_checkPots();
	soundengine_process();
	buttonHandler_tick();
	adc_checkPots();
	menu_parseEncoder(encode_read4(), encode_readButton());
	led_tickHandler();
	adc_checkPots();
	soundengine_process();
	screensaver_check();
	dio_process();
	adc_checkPots();
	soundengine_process();
	adc_checkFaders();

	MidiMsg msg;
	if (usb_getMidi(&msg)) midiParser_parseMidiMessage(msg);
	uart_processMidi();
	preset_processTimer();

	uart_drain_tx();
}

/* Render the next 64 frames. out1/out2: interleaved stereo int16 of DAC 1
 * (main out) and DAC 2, OUTPUT_DMA_SIZE frames each. */
void emu_render_block(int16_t *out1, int16_t *out2)
{
	/* time that passes while the previous block plays */
	tim14_acc += (uint64_t)OUTPUT_DMA_SIZE * TIM14_DEN;
	ms_acc += (uint64_t)OUTPUT_DMA_SIZE * MS_DEN;
	while (tim14_acc >= TIM14_NUM || ms_acc >= MS_NUM) {
		/* run whichever interrupt comes first */
		const uint64_t t14 = tim14_acc >= TIM14_NUM ? (tim14_acc - TIM14_NUM) * MS_DEN : 0;
		const uint64_t tms = ms_acc >= MS_NUM ? (ms_acc - MS_NUM) * TIM14_DEN : 0;
		if (tim14_acc >= TIM14_NUM && (ms_acc < MS_NUM || t14 >= tms)) {
			tim14_acc -= TIM14_NUM;
			tim14_irq();
			seq_tick();
		} else {
			ms_acc -= MS_NUM;
			systick_irq();
		}
	}

	/* DMA finished one half: the firmware now fills that half
	 * (HAL_I2S_TxCpltCallback sets bCurrentSampleValid to it). */
	bCurrentSampleValid = dma_half;
	emu_main_loop_iteration();
	if (bCurrentSampleValid != SAMPLE_VALID) {
		/* the main loop did not get to it (it always does, via
		 * soundengine_process); the TIM2 interrupt would */
		seq_tick();
		soundengine_calcNextSampleBlock();
	}

	/* mixer.c writes MIXER_ROUTING_DAC1_* (out 1) to its output2 argument,
	 * which is dma_buffer2, and DAC2 (out 2) to dma_buffer. */
	const int16_t *src1 = &dma_buffer2[dma_half * (OUTPUT_DMA_SIZE * 2)];
	const int16_t *src2 = &dma_buffer[dma_half * (OUTPUT_DMA_SIZE * 2)];
	memcpy(out1, src1, OUTPUT_DMA_SIZE * 2 * sizeof(int16_t));
	memcpy(out2, src2, OUTPUT_DMA_SIZE * 2 * sizeof(int16_t));
	dma_half ^= 1;
	samples_rendered += OUTPUT_DMA_SIZE;
}

/* LED bits as sent to the 74HC595 chain, bit n = LED n (enum in
 * ledHandler.h), plus LED_PAGE_DOWN (bit 40) on its own GPIO pin. */
uint64_t emu_leds(void)
{
	uint64_t v = 0;
	for (int i = 0; i < 5; i++) v |= (uint64_t)emu_panel.leds[i] << (8 * i);
	if (LED_43_GPIO_Port->ODR & LED_43_Pin) v |= 1ull << 40;
	return v;
}

uint64_t emu_samples_rendered(void) { return samples_rendered; }
uint32_t emu_millis(void) { return emu_ms_count; }
