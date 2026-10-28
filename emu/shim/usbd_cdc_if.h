/* LXR-02 Emu (unofficial) - stand-in for USB_DEVICE_MIDI/App/usbd_cdc_if.h.
 * SPDX-License-Identifier: GPL-3.0-only */
#ifndef EMU_USBD_CDC_IF_H
#define EMU_USBD_CDC_IF_H
#include "usbd_cdc.h"
uint8_t CDC_Transmit_FS(uint8_t *Buf, uint16_t Len);
#endif
