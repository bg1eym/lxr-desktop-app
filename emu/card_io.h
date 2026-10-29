/*
 * LXR-02 Emu (unofficial) - files in and out of the virtual SD card.
 *
 * Copyright (C) 2026 LXR-02 Emu contributors
 * SPDX-License-Identifier: GPL-3.0-only
 */
#ifndef EMU_CARD_IO_H
#define EMU_CARD_IO_H

#include <stdint.h>

uint8_t *card_buffer(uint32_t size);   /* file data in and out, grows as needed */
char *card_path_buffer(void);           /* path for card_import_file(), 96 bytes */

/* Export, while the firmware runs. */
int card_scan(void);                    /* number of entries, or < 0 */
const char *card_entry_path(int i);     /* absolute, e.g. "/PROJ00/00-INIT.PRJ" */
uint32_t card_entry_size(int i);
int card_entry_is_dir(int i);
int32_t card_entry_read(int i);         /* into card_buffer(); length or < 0 */

/* Import, after the card is created and before power-on. */
int card_import_begin(void);            /* format + mount */
int card_import_file(uint32_t len, int is_dir);
int card_import_end(void);

#endif
