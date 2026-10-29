/*
 * LXR-02 Emu (unofficial) - HAL stand-ins: GPIO, timers, SPI shift
 * registers, RNG and time.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include <string.h>
#include "stm32f7xx_hal.h"
#include "emu_hw.h"

GPIO_TypeDef emu_gpio[11];
USART_TypeDef emu_usart[3];
CoreDebug_Type emu_coredebug;
FPU_Type emu_fpu;

static DWT_Type emu_dwt_regs;
static uint32_t emu_ms;
static uint32_t rng_state = 1;

emu_panel_t emu_panel;

/* ------------------------------------------------------------------------ */
GPIO_PinState HAL_GPIO_ReadPin(GPIO_TypeDef *port, uint16_t pin)
{
	return (port->IDR & pin) ? GPIO_PIN_SET : GPIO_PIN_RESET;
}

void HAL_GPIO_WritePin(GPIO_TypeDef *port, uint16_t pin, GPIO_PinState state)
{
	if (state == GPIO_PIN_SET) port->ODR |= pin;
	else port->ODR &= ~(uint32_t)pin;
}

void HAL_GPIO_TogglePin(GPIO_TypeDef *port, uint16_t pin)
{
	port->ODR ^= pin;
}

/* ------------------------------------------------------------------------ */
HAL_StatusTypeDef HAL_TIM_Base_Start_IT(TIM_HandleTypeDef *h) { h->running = 1; return HAL_OK; }
HAL_StatusTypeDef HAL_TIM_Base_Stop_IT(TIM_HandleTypeDef *h)  { h->running = 0; return HAL_OK; }
HAL_StatusTypeDef HAL_TIM_Base_Start(TIM_HandleTypeDef *h)    { h->running = 1; return HAL_OK; }
HAL_StatusTypeDef HAL_TIM_Base_Stop(TIM_HandleTypeDef *h)     { h->running = 0; return HAL_OK; }

/* ------------------------------------------------------------------------
 * SPI1 drives the 74HC165 button and 74HC595 LED shift registers (IO/DIO.c).
 * Receive returns the virtual button bits, transmit latches the LED bits. */
HAL_StatusTypeDef HAL_SPI_Init(SPI_HandleTypeDef *h) { (void)h; return HAL_OK; }

HAL_StatusTypeDef HAL_SPI_Receive(SPI_HandleTypeDef *h, uint8_t *data, uint16_t size, uint32_t timeout)
{
	(void)h; (void)timeout;
	if (size > sizeof(emu_panel.buttons)) size = sizeof(emu_panel.buttons);
	memcpy(data, emu_panel.buttons, size);
	return HAL_OK;
}

HAL_StatusTypeDef HAL_SPI_Transmit(SPI_HandleTypeDef *h, uint8_t *data, uint16_t size, uint32_t timeout)
{
	(void)h; (void)timeout;
	if (size > sizeof(emu_panel.leds)) size = sizeof(emu_panel.leds);
	memcpy(emu_panel.leds, data, size);
	return HAL_OK;
}

HAL_StatusTypeDef HAL_SPI_TransmitReceive(SPI_HandleTypeDef *h, uint8_t *tx, uint8_t *rx, uint16_t size, uint32_t timeout)
{
	HAL_SPI_Receive(h, rx, size, timeout);
	return HAL_SPI_Transmit(h, tx, size, timeout);
}

/* ------------------------------------------------------------------------
 * The hardware RNG is replaced by a seeded xorshift32, so renders can be
 * reproduced exactly. */
void emu_rng_seed(uint32_t seed)
{
	rng_state = seed ? seed : 0x9E3779B9u;
}

uint32_t HAL_RNG_GetRandomNumber(RNG_HandleTypeDef *h)
{
	(void)h;
	uint32_t x = rng_state;
	x ^= x << 13;
	x ^= x >> 17;
	x ^= x << 5;
	rng_state = x;
	return x;
}

/* ------------------------------------------------------------------------
 * Time. The only clock is the number of rendered samples: emu/platform.c
 * moves the millisecond counter on as it renders, and also when the
 * firmware polls it in a loop (emu_tick_polled). Blocking delays return at
 * once, because nothing else runs while the firmware waits. */
void emu_time_set_ms(uint32_t ms) { emu_ms = ms; }
uint32_t HAL_GetTick(void)
{
	emu_tick_polled();
	return emu_ms;
}
void HAL_Delay(uint32_t ms) { (void)ms; }
uint32_t HAL_RCC_GetHCLKFreq(void) { return 216000000u; }

DWT_Type *emu_dwt(void)
{
	/* Each read is worth 1 ms of CPU time, more than any wait in the
	 * firmware, so DWT_check_nonblock() succeeds on its first poll. */
	emu_dwt_regs.CYCCNT += 216000u;
	return &emu_dwt_regs;
}

/* Replaces Core/Src/delay.c: the counter is always running here. */
uint32_t DWT_Delay_Init(void)
{
	return 0;
}

void Error_Handler(void)
{
	emu_fatal("Error_Handler called");
}
