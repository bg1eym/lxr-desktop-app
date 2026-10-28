/*
 * LXR-02 Emu (unofficial) - host stand-in for the STM32F7 HAL and CMSIS.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Only what the firmware sources actually use is provided. Peripheral
 * registers are plain RAM, HAL calls go to emu/hw/hal_emu.c, and the ARM DSP
 * intrinsics are reimplemented in portable C with the same results.
 */
#ifndef EMU_STM32F7XX_HAL_H
#define EMU_STM32F7XX_HAL_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* --- CMSIS compiler macros --------------------------------------------- */
#define __IO volatile
#define __I  volatile const
#define __O  volatile
#define __STATIC_INLINE static inline
#define __INLINE inline
#define __ASM __asm__
#ifndef __weak
#define __weak __attribute__((weak))
#endif
#ifndef __packed
#define __packed __attribute__((packed))
#endif
#define __NOP() do { } while (0)
#define __DSB() do { } while (0)
#define __ISB() do { } while (0)
#define __DMB() do { } while (0)
#define __disable_irq() do { } while (0)
#define __enable_irq() do { } while (0)
static inline uint32_t __get_PRIMASK(void) { return 0; }
static inline void __set_PRIMASK(uint32_t m) { (void)m; }
#define UNUSED(x) ((void)(x))

/* --- ARM DSP / saturation intrinsics ------------------------------------
 * Same semantics as the Cortex-M7 instructions. Arguments arrive the way the
 * CMSIS-GCC versions receive them (converted to 32-bit integers). For __SSAT
 * a float argument is converted like the VCVT the compiler emits on ARM
 * (truncate towards zero, saturate to int32, NaN -> 0), so a float overflow
 * gives the same result as on the hardware instead of undefined behaviour. */
static inline int32_t emu_f2i32(double v)
{
	if (v != v) return 0;
	if (v >= 2147483647.0) return INT32_MAX;
	if (v <= -2147483648.0) return INT32_MIN;
	return (int32_t)v;
}
static inline int32_t emu_ssat(int32_t v, unsigned bits)
{
	const int32_t max = (int32_t)((1u << (bits - 1)) - 1u);
	const int32_t min = -max - 1;
	return v > max ? max : (v < min ? min : v);
}
static inline uint32_t emu_usat(int32_t v, unsigned bits)
{
	const int32_t max = (int32_t)((1u << bits) - 1u);
	return v < 0 ? 0u : (uint32_t)(v > max ? max : v);
}
#define __SSAT(ARG1, ARG2) emu_ssat(emu_f2i32((double)(ARG1)), (ARG2))
#define __USAT(ARG1, ARG2) emu_usat(emu_f2i32((double)(ARG1)), (ARG2))

static inline int16_t emu_sat16(int32_t v)
{
	return (int16_t)(v > 32767 ? 32767 : (v < -32768 ? -32768 : v));
}
static inline uint32_t __QADD16(uint32_t op1, uint32_t op2)
{
	const int32_t lo = (int16_t)(op1 & 0xFFFF) + (int16_t)(op2 & 0xFFFF);
	const int32_t hi = (int16_t)(op1 >> 16) + (int16_t)(op2 >> 16);
	return ((uint32_t)(uint16_t)emu_sat16(hi) << 16) | (uint16_t)emu_sat16(lo);
}
static inline uint32_t __QSUB16(uint32_t op1, uint32_t op2)
{
	const int32_t lo = (int16_t)(op1 & 0xFFFF) - (int16_t)(op2 & 0xFFFF);
	const int32_t hi = (int16_t)(op1 >> 16) - (int16_t)(op2 >> 16);
	return ((uint32_t)(uint16_t)emu_sat16(hi) << 16) | (uint16_t)emu_sat16(lo);
}
static inline int32_t __QADD(int32_t a, int32_t b)
{
	const int64_t r = (int64_t)a + b;
	return r > INT32_MAX ? INT32_MAX : (r < INT32_MIN ? INT32_MIN : (int32_t)r);
}
static inline int32_t __QSUB(int32_t a, int32_t b)
{
	const int64_t r = (int64_t)a - b;
	return r > INT32_MAX ? INT32_MAX : (r < INT32_MIN ? INT32_MIN : (int32_t)r);
}
#define __PKHBT(ARG1, ARG2, ARG3) \
	((((uint32_t)(ARG1)) & 0x0000FFFFUL) | ((((uint32_t)(ARG2)) << (ARG3)) & 0xFFFF0000UL))
#define __PKHTB(ARG1, ARG2, ARG3) \
	((((uint32_t)(ARG1)) & 0xFFFF0000UL) | ((((uint32_t)(ARG2)) >> (ARG3)) & 0x0000FFFFUL))
/* Only read by calcNoise(), which nothing calls (Oscillator.c). */
typedef union {
	struct { uint32_t _reserved0:27; uint32_t Q:1; uint32_t V:1; uint32_t C:1; uint32_t Z:1; uint32_t N:1; } b;
	uint32_t w;
} APSR_Type;
static inline uint32_t __get_APSR(void) { return 0; }
static inline uint8_t __CLZ(uint32_t v)
{
	return v == 0u ? 32u : (uint8_t)__builtin_clz(v);
}

/* --- HAL basics -------------------------------------------------------- */
typedef enum { HAL_OK = 0, HAL_ERROR = 1, HAL_BUSY = 2, HAL_TIMEOUT = 3 } HAL_StatusTypeDef;
typedef enum { RESET = 0, SET = !RESET } FlagStatus, ITStatus;
typedef enum { DISABLE = 0, ENABLE = !DISABLE } FunctionalState;
typedef enum { GPIO_PIN_RESET = 0, GPIO_PIN_SET } GPIO_PinState;

/* --- GPIO: ports are RAM, so register writes are just stored ------------ */
typedef struct {
	__IO uint32_t MODER, OTYPER, OSPEEDR, PUPDR, IDR, ODR, BSRR, LCKR, AFR[2];
} GPIO_TypeDef;
extern GPIO_TypeDef emu_gpio[11];
#define GPIOA (&emu_gpio[0])
#define GPIOB (&emu_gpio[1])
#define GPIOC (&emu_gpio[2])
#define GPIOD (&emu_gpio[3])
#define GPIOE (&emu_gpio[4])
#define GPIOF (&emu_gpio[5])
#define GPIOG (&emu_gpio[6])
#define GPIOH (&emu_gpio[7])

#define GPIO_PIN_0  ((uint16_t)0x0001)
#define GPIO_PIN_1  ((uint16_t)0x0002)
#define GPIO_PIN_2  ((uint16_t)0x0004)
#define GPIO_PIN_3  ((uint16_t)0x0008)
#define GPIO_PIN_4  ((uint16_t)0x0010)
#define GPIO_PIN_5  ((uint16_t)0x0020)
#define GPIO_PIN_6  ((uint16_t)0x0040)
#define GPIO_PIN_7  ((uint16_t)0x0080)
#define GPIO_PIN_8  ((uint16_t)0x0100)
#define GPIO_PIN_9  ((uint16_t)0x0200)
#define GPIO_PIN_10 ((uint16_t)0x0400)
#define GPIO_PIN_11 ((uint16_t)0x0800)
#define GPIO_PIN_12 ((uint16_t)0x1000)
#define GPIO_PIN_13 ((uint16_t)0x2000)
#define GPIO_PIN_14 ((uint16_t)0x4000)
#define GPIO_PIN_15 ((uint16_t)0x8000)

GPIO_PinState HAL_GPIO_ReadPin(GPIO_TypeDef *port, uint16_t pin);
void HAL_GPIO_WritePin(GPIO_TypeDef *port, uint16_t pin, GPIO_PinState state);
void HAL_GPIO_TogglePin(GPIO_TypeDef *port, uint16_t pin);

/* EXTI (clock/reset jacks): never pending in the emulator. */
#define __HAL_GPIO_EXTI_GET_IT(pin) (0u)
#define __HAL_GPIO_EXTI_CLEAR_IT(pin) do { (void)(pin); } while (0)
typedef enum { EXTI4_IRQn = 10, EXTI9_5_IRQn = 23, DMA1_Stream3_IRQn = 14,
	DMA1_Stream4_IRQn = 15, DMA1_Stream7_IRQn = 47, TIM2_IRQn = 28 } IRQn_Type;
static inline void HAL_NVIC_SetPriority(IRQn_Type n, uint32_t p, uint32_t s) { (void)n; (void)p; (void)s; }
static inline void HAL_NVIC_EnableIRQ(IRQn_Type n) { (void)n; }
static inline void HAL_NVIC_DisableIRQ(IRQn_Type n) { (void)n; }

/* --- Peripheral handles: only carry what the application touches -------- */
typedef struct { uint32_t CNT; uint32_t DIER; } TIM_TypeDef;
typedef struct { TIM_TypeDef *Instance; uint32_t running; } TIM_HandleTypeDef;
#define TIM_IT_UPDATE 0x1u
#define __HAL_TIM_ENABLE_IT(h, it)  ((h)->Instance->DIER |= (it))
#define __HAL_TIM_DISABLE_IT(h, it) ((h)->Instance->DIER &= ~(it))
#define __HAL_TIM_CLEAR_IT(h, it)   do { (void)(h); (void)(it); } while (0)
#define __HAL_TIM_SetCounter(h, v)  ((h)->Instance->CNT = (v))
#define __HAL_TIM_SET_COUNTER(h, v) ((h)->Instance->CNT = (v))
#define __HAL_TIM_GetCounter(h)     ((h)->Instance->CNT)
#define __HAL_TIM_GET_COUNTER(h)    ((h)->Instance->CNT)
HAL_StatusTypeDef HAL_TIM_Base_Start_IT(TIM_HandleTypeDef *h);
HAL_StatusTypeDef HAL_TIM_Base_Stop_IT(TIM_HandleTypeDef *h);
HAL_StatusTypeDef HAL_TIM_Base_Start(TIM_HandleTypeDef *h);
HAL_StatusTypeDef HAL_TIM_Base_Stop(TIM_HandleTypeDef *h);

typedef struct { uint32_t dummy; } SPI_TypeDef;
typedef struct { SPI_TypeDef *Instance; } SPI_HandleTypeDef;
HAL_StatusTypeDef HAL_SPI_Init(SPI_HandleTypeDef *h);
HAL_StatusTypeDef HAL_SPI_Transmit(SPI_HandleTypeDef *h, uint8_t *data, uint16_t size, uint32_t timeout);
HAL_StatusTypeDef HAL_SPI_Receive(SPI_HandleTypeDef *h, uint8_t *data, uint16_t size, uint32_t timeout);
HAL_StatusTypeDef HAL_SPI_TransmitReceive(SPI_HandleTypeDef *h, uint8_t *tx, uint8_t *rx, uint16_t size, uint32_t timeout);

typedef struct { __IO uint32_t CR1, CR2, CR3, BRR, GTPR, RTOR, RQR, ISR, ICR, RDR, TDR; } USART_TypeDef;
typedef struct { USART_TypeDef *Instance; } UART_HandleTypeDef;
extern USART_TypeDef emu_usart[3];
#define USART1 (&emu_usart[0])
#define USART2 (&emu_usart[1])
#define USART3 (&emu_usart[2])
#define USART_ISR_RXNE (1u << 5)
#define USART_ISR_TXE  (1u << 7)
#define USART_ISR_ORE  (1u << 3)
#define READ_REG(REG) ((REG))
#define WRITE_REG(REG, VAL) ((REG) = (VAL))
#define SET_BIT(REG, BIT) ((REG) |= (BIT))
#define CLEAR_BIT(REG, BIT) ((REG) &= ~(BIT))
#define UART_IT_RXNE (1u << 5)  /* same bit as the CR1 RXNEIE flag */
#define UART_IT_TXE  (1u << 7)  /* same bit as the CR1 TXEIE flag */
#define __HAL_UART_ENABLE_IT(h, it)  ((h)->Instance->CR1 |= (it))
#define __HAL_UART_DISABLE_IT(h, it) ((h)->Instance->CR1 &= ~(it))
#define __HAL_UART_CLEAR_OREFLAG(h)  do { (void)(h); } while (0)

typedef struct { uint32_t dummy; } RNG_HandleTypeDef;
uint32_t HAL_RNG_GetRandomNumber(RNG_HandleTypeDef *h);

typedef struct { uint32_t dummy; } ADC_HandleTypeDef;
typedef struct { uint32_t dummy; } DMA_HandleTypeDef;
typedef struct { uint32_t dummy; } I2S_HandleTypeDef;
typedef struct { uint32_t dummy; } SD_HandleTypeDef;
typedef struct { uint32_t dummy; } PCD_HandleTypeDef;
typedef struct {
	uint32_t CardType, CardVersion, Class, RelCardAdd, BlockNbr, BlockSize, LogBlockNbr, LogBlockSize;
} HAL_SD_CardInfoTypeDef;
#define I2S_AUDIOFREQ_44K 44100u

/* --- Time --------------------------------------------------------------- */
uint32_t HAL_GetTick(void);
void HAL_Delay(uint32_t ms);
uint32_t HAL_RCC_GetHCLKFreq(void);

/* Cycle counter used by the busy-wait helpers in delay.h. Every read moves
 * the counter on by a fixed amount, so those loops end after a few turns. */
typedef struct { __IO uint32_t CTRL, CYCCNT, LAR; } DWT_Type;
DWT_Type *emu_dwt(void);
#define DWT (emu_dwt())
#define DWT_CTRL_CYCCNTENA_Msk 1u
typedef struct { __IO uint32_t DEMCR; } CoreDebug_Type;
extern CoreDebug_Type emu_coredebug;
#define CoreDebug (&emu_coredebug)
#define CoreDebug_DEMCR_TRCENA_Msk (1u << 24)

typedef struct { __IO uint32_t FPDSCR; } FPU_Type;
extern FPU_Type emu_fpu;
#define FPU (&emu_fpu)
#define FPU_FPDSCR_FZ_Msk (1u << 24)

static inline void SCB_CleanDCache(void) { }
static inline void SCB_InvalidateDCache(void) { }
static inline void NVIC_SystemReset(void) { }

void Error_Handler(void);

#ifdef __cplusplus
}
#endif
#endif /* EMU_STM32F7XX_HAL_H */
