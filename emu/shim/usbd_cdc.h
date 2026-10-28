/*
 * LXR-02 Emu (unofficial) - stand-in for the customised usbd_cdc.h
 * (Middlewares/JS/.../Class/CDC/Inc). The USB device stack is not built; only
 * the USB-MIDI queues that Soundengine/USB/usb_manager.c uses are declared
 * here and defined in emu/hw/usb_emu.c.
 * SPDX-License-Identifier: GPL-3.0-only
 */
#ifndef EMU_USBD_CDC_H
#define EMU_USBD_CDC_H
#include <stdint.h>
#include "Soundengine/MIDI/MidiMessages.h"

#define USB_MIDI_INPUT_BUFFER_SIZE 	64
#define USB_MIDI_INPUT_BUFFER_MASK	0x3F
#define TOTAL_MIDI_BUF_SIZE		0x40
#define NUM_SUB_BUFFERS			0x2

extern MidiMsg usb_MidiMessages[USB_MIDI_INPUT_BUFFER_SIZE];
extern uint8_t usb_MidiMessagesRead;
extern uint8_t usb_MidiMessagesWrite;

extern uint8_t  usb_MidiInBuff [TOTAL_MIDI_BUF_SIZE * NUM_SUB_BUFFERS];
extern uint8_t* usb_MidiInWrPtr;
extern uint8_t* usb_MidiInRdPtr;
#endif
