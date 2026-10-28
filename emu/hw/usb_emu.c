/*
 * LXR-02 Emu (unofficial) - USB-MIDI queues normally defined by the USB
 * device class (usbd_cdc.c). Nothing is connected to them: MIDI from the
 * browser goes through the DIN port (USART3) instead, and what the firmware
 * sends over USB is dropped, since it duplicates the DIN output.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include "usbd_cdc_if.h"

MidiMsg usb_MidiMessages[USB_MIDI_INPUT_BUFFER_SIZE];
uint8_t usb_MidiMessagesRead = 0;
uint8_t usb_MidiMessagesWrite = 0;

uint8_t  usb_MidiInBuff [TOTAL_MIDI_BUF_SIZE * NUM_SUB_BUFFERS];
uint8_t* usb_MidiInWrPtr = usb_MidiInBuff;
uint8_t* usb_MidiInRdPtr = usb_MidiInBuff;

uint8_t CDC_Transmit_FS(uint8_t *Buf, uint16_t Len)
{
	(void)Buf; (void)Len;
	return 0;
}
