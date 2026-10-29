# LXR-02 浏览器模拟器（交接提示词 / 计划）

> 非官方项目。"Erica Synths"、"LXR"、"LXR-02" 是商标，本项目称为 **LXR-02 Emu (unofficial)**。

你在 Erica Synths LXR-02 官方开源固件的 fork 仓库里工作。代码是 v1.7（上游 commit `a43cd4f`），协议 GPL-3.0-only。用户叫 Qiang，用中文和他交流。他有一台 LXR-02，固件是 1.7，用的是 Mac + Chrome。他平时用 Ableton Move 学电子音乐，主要做 Techno 和 Trance。

开始写代码前，先把这份文档存成 `docs/EMULATOR_PLAN.md`，新建分支 `emu`，之后分小步提交。

## 1. 要做什么

做一个在 Mac 的 Chrome 里运行的 LXR-02 模拟器兼编辑器。实体机器很难操作，用户想先在电脑上把音色参数和音序调好，再导入真机。

- 跑的是官方固件自己的 C 代码，编译成 WASM，放在 AudioWorklet 里运行。这样声音和真机基本一致。
- 用一套比硬件好用得多的界面来编辑音色（每个 kit 247 个参数）和音序。
- 导出 SD 卡上的工程文件，拷进真机的 SD 卡后，1.7 固件能直接读取。
- 后期再加 Web MIDI 联机：用 NRPN 把参数同步到真机，同时同步时钟。
- 最后用 GitHub Actions 部署到 GitHub Pages，用户在 Mac 上打开一个网址就能用。

不做：复刻硬件那套现场演奏流程（mute、roll、morph 留在真机上做）、刷机、动 bootloader。

## 2. 核心原则：不重写

声音引擎、音序器和存盘代码一律直接编译固件原文件，只替换硬件层。读写文件必须经过 `presetManager.c`，这样导出的文件和真机自己写出来的完全一样。确实必须改固件文件时，只加最小的 `#ifdef LXR_EMU`，并在本文档末尾的「固件改动清单」里列出。

## 3. 已经从代码里核实的事实

前一个会话读代码确认过以下内容。行号是大概位置，动手前再核对一遍。

### 整体结构

- 单片机是 STM32F765，只有一颗芯片，但代码还保留着初代 LXR 双芯片时的分工：
  - 前面板这一侧：`menu/`、`Preset/presetManager.c`、`buttonHandler.c`、`frontPanelParser.c`、`ledHandler.c`、`lcd.c`。
  - 声音引擎这一侧：`Soundengine/*`、`Soundengine/MIDI/CortexParser.c`。
  - 两边通过 `Core/Src/Soundengine/MIDI/Uart.c` 里的内存 FIFO 通信：`fifo_frontTx`/`fifo_frontRx`、`uart_sendFrontpanelByte()`，以及 `frontPanelParser.c` 里的 `frontPanel_sendData()` → `uart_putc()`（`uart_putc` 在 `Core/Src/IO/uart.c`）。
- 参数有两套枚举：前面板用 `Core/Inc/Parameters.h`，引擎用 `Core/Inc/Soundengine/MIDI/ParameterArray.h`。`END_OF_SOUND_PARAMETERS` = 247（不是 228，`Parameters.h` 里的注释过时了），之后是 `PAR_BEGINNING_OF_GLOBALS`（`PAR_BPM` = 272），最后是 `NUM_PARAMS` = 302。`NUM_KIT_SLOTS` = 64。
- `menu.h` 里有这些数组：`activeParameters[NUM_PARAMS]` 是当前 kit 的编辑缓冲，`mainParameters[64][228]` 是内存里的全部 kit，另外还有 `parameter_dtypes[NUM_PARAMS]` 和 `paramToModTarget[]`。

### 音频

- I2S 采样率 44.1kHz，但 DSP 系数按 `REAL_FS = 44140.f` 计算（见 `Core/Inc/Soundengine/config.h`）。全程 int16。
- 每块 `OUTPUT_DMA_SIZE = 64` 个立体声帧。`mixer_calcNextSampleBlock(dma_buffer半区, dma_buffer2半区)` 输出到两个立体声 DAC，共 4 路输出（`USE_DAC2 = 1`）。
- 入口是 `soundengine_calcNextSampleBlock()`。它由 TIM2 中断调用，顺序是 `seq_tick(); soundengine_calcNextSampleBlock(); uart_processMidi();`（见 `stm32f7xx_it.c`）。`bCurrentSampleValid` 由 `cs4344_cs5343.c` 里的 DMA 回调切换。
- 波表和瞬态采样都编进了代码（`DSPAudio/Samples.c`、`wavetable.c`、`transientTables.c`），不依赖外部采样文件。
- ARM 专用指令：`__SSAT`、`__QADD16` 等，出现在 `CymbalVoice.c`、`ResonantFilter.c`、`Snare.c`、`HiHat.c`、`mixer.c`、`FX/*.c`、`FxBus.c`、`BufferTools.h`、`Reverb.h`。用 C 写等价实现。
- 在引擎里用到 HAL 的地方：`DSPAudio/random.c`（`HAL_RNG_GetRandomNumber`，改成可设种子的 PRNG，测试要能复现）、`1PoleLp.c`、`sequencer.c`。`soundengine_init()` 里有 `FPU->FPDSCR` 的 flush-to-zero 设置（WASM 里不支持，可忽略，但要留意 denormal）。
- 段属性 `INDTCM`、`INDTCMZ`、`IN_ITCM_RAM` 定义成空。

### 时钟

- TIM14 中断约 4kHz，每 0.25ms 一次（108MHz ÷ 13501 ÷ 2）。它会把 `systick_ticks` 加一；当 `lcd_process_display_interrupt` 为真时，还会连续调用 4 次 `menu_tick()`。
- 音序器靠 `systick_ticks` 计时：`seq_deltaT = (60000/bpm)/96*4`，单位是 0.25ms，内部 96 ppq。
- 模拟方式：以音频采样数作为唯一时钟。每渲染 64 帧，systick 前进 64/44100×4000 ≈ 5.8 tick（用小数累加），对每个 tick 执行 TIM14 那段逻辑，再执行一次 TIM2 那段逻辑，然后跑一遍主循环。

### 开机和主循环（`main.c`）

- 开机流程大约在 239–917 行：`menu_init()` → `f_mount` → 对 64 个槽位调用 `preset_loadProjectNames(i)` → 因为 `LOAD_PROJECT_ON_BOOT = 1`（`Core/Inc/config.h`），执行 `preset_loadLastUsedProjectNrFromSD()` + `preset_loadProject()` → `preset_initTmpFolder()` → `loadTmpFolderFiles()` → `preset_LoadTmpKit()` → `preset_LoadTmpPat()`。
- 主循环大约在 918–1000 行：`adc_checkPots`、`soundengine_process`、`buttonHandler_tick`、`menu_parseEncoder`、`led_tickHandler`、`dio_process`、`adc_checkFaders`、USB MIDI、`uart_processMidi`、`preset_processTimer`。
- 写 `emu/platform.c` 取代 `main.c`，按原顺序复刻开机流程，主循环做成每块调用一次的 `emu_main_loop_iteration()`。

### SD 卡和文件格式

- 工程目录是 `/projNN/`（代码里是 `sprintf("/proj%02d")`）。文件名格式为 `NN-NAME.ext`，NAME 取名字前 5 个字符，空格换成 `_`。扩展名：`.snd`（kit）、`.pat`、`.all`、`.prj`、`.sng`。另有一个 `/tmp` 目录放自动存档（`tmp.snd`、`tmp.pat`）。FatFs 配置在 `FATFS/Target/ffconf.h`：`_USE_LFN 0`，只用 8.3 短文件名；`_FS_RPATH 1`，代码依赖 `f_chdir` 的相对路径。
- kit 文件基本就是 `activeParameters[0..247)` 的原样 dump，具体头部结构见 `preset_writeDrumsetData`/`preset_readDrumsetData`。pattern 带版本号，见 `preset_readPatternData(patternNr, dataVersion)`。
- 保留 FatFs 的 API，把 `f_open/f_read/f_write/f_close/f_lseek/f_stat/f_mkdir/f_chdir/f_getcwd/f_opendir/f_readdir/f_unlink/f_rename/f_mount` 映射到 POSIX：本机构建用真实目录，WASM 构建用 Emscripten MEMFS。`FIL`、`DIR`、`FILINFO`、`FRESULT` 的类型和语义要和原版一致，包括 8.3 文件名和大小写行为。

### MIDI

- 官方固件能接收 NRPN 和 CC 来设置音色参数（见 `MidiParser.c`）。
- 没有外部 SysEx 导入 kit 或 pattern 的功能。`CortexParser.c` 里的 SysEx 是前面板和引擎之间的内部协议。
- 所以把 pattern 导进真机只能走 SD 卡；音色参数可以用 NRPN/CC 实时同步。NRPN 和参数的对应关系从 `MidiParser.c`、`ParameterArray.c` 里推导。

### UI 能直接借用的表

- 参数页、文字和数据类型在 `Core/Inc/menu/menuPages.h`、`MenuText.h`、`menu.c`（`parameter_dtypes`）、`Cc2Text.c` 里。参数名、范围、分组都从这些表生成，不要手写。

### 硬件界面

- LCD 是 2×16 字符屏（`lcd.c`，HD44780 风格）。
- 按键和 LED 经移位寄存器连接（`IO/DIO.c`，走 SPI）。旋钮走 ADC（`IO/adcPots.c`），另有 `encoder.c`。
- 都做成虚拟版本：LCD 写进字符缓冲，按键、LED、旋钮做成内存数组。这样可以在网页上显示一个调试用的虚拟面板，也可以直接驱动原菜单代码完成存盘这类操作。

## 4. 目录和架构建议

```
emu/
  shim/        假的 stm32f7xx_hal.h、cmsis 内建函数、FatFs 转 POSIX
  platform.c   取代 main.c、codec、USB、UART、DIO/ADC/LCD 的硬件部分
  api.c        导出给 JS 的 C API
  cli/         本机命令行：离线渲染 WAV、回归测试
  CMakeLists.txt（本机构建 + Emscripten 构建）
web/           前端（Vite + TypeScript，框架尽量轻）
.github/workflows/pages.yml   构建 WASM 和前端，部署到 GitHub Pages
```

C API 至少包括：

- `lxr_init(seed)`
- `lxr_render(float* out4ch, int frames)`
- `lxr_set_param(idx, val)` 和 `lxr_get_param(idx)`：走前面板改参数的同一条路径，保证 `activeParameters` 和引擎状态一致
- 步进编辑：读写 step、velocity、probability、p-lock，走前面板的音序函数
- `lxr_trigger(voice, vel)`
- 走带控制：start、stop、bpm
- 工程操作：save、load kit、pattern、project，一律调用 presetManager
- `lxr_midi_in(bytes)`，以及 MIDI out 回调
- `lxr_get_lcd()` 和 LED 状态

前端：

- 7 条轨（Drum 1–3、Snare/Clap、Cymbal、Closed/Open Hat）。每个音色的参数按硬件分页分组（OSC、AEG、Pitch/Mod EG、FM、Transient/Click、Filter、LFO、Mix），FX Bus 单独一组。
- 步进网格：16 步，每步可展开 8 个子步；支持 velocity、probability、p-lock 和 pattern 链。
- 导入导出：用 File System Access API（`showDirectoryPicker`，Chrome 支持）直接读写 SD 卡目录，同时提供 zip 下载作为备选。
- 可选的虚拟前面板（LCD + 按键），用于调试和核对。
- 可以把任意 pattern 导出成 WAV 或分轨，方便用户拿到 Move 上用。

参考项目：`github.com/dmajka/elixir`（GPL-3）。它把 LXR-02 移植到了 M-VAVE FM-1，有一个浏览器模拟器（用 Web MIDI 跑固件 C 代码），DSP 改成了定点。它的浏览器和 Web MIDI 部分可以参考，但我们用官方浮点代码，以保证和真机一致。

## 5. 分阶段计划和验收标准

- **P0 本机构建**：`emu/cli` 编译、链接通过；用默认 kit 和 pattern 渲染 2 小节 WAV，不能是静音，不能有 NaN；同一个种子渲染两次，结果逐字节相同。
- **P1 文件往返**：从空目录开机，生成的目录结构和真机一致；读入用户提供的真机 SD 卡 dump 后原样存回，文件逐字节相同（有意的修改除外）。到这一步时，用中文请用户把 SD 卡整个拷一份上传。
- **P2 WASM**：在 Chrome 里通过 AudioWorklet 出声，CPU 占用低于一个核的 30%，没有爆音。
- **P3 编辑器**：参数面板和步进网格可用；导出的文件拷进 SD 卡后真机能加载（请用户实测）。
- **P4 Web MIDI**：NRPN 参数镜像，时钟进出。
- **P5 和真机 A/B**：请用户用真机录几段参考音（每个音色用 init 设置，加几组指定参数），和模拟器渲染的结果做频谱对比或相减测试，把偏差记下来（比如 `REAL_FS` 44140 和 44100 的差别）。
- 每完成一个阶段：提交代码，把能用的网址或产物交给用户，用中文写一两句进展。

## 6. 约束

- 模拟器属于 GPL-3.0-only 固件的衍生作品，所以整体也用 GPL-3.0；保留 `LICENSE` 和 `NOTICE.md`。
- 页面和 README 要写明是非官方项目。"Erica Synths"、"LXR"、"LXR-02" 是商标，不要当成产品名，可以叫 "LXR-02 Emu (unofficial)"。
- 不修改 bootloader，不碰刷机相关的 target。
- 先跑通 P0，不要一开始就写界面。

## 固件改动清单（`#ifdef LXR_EMU`）

（随开发更新。每条写明文件、位置和原因。）

- `Core/Src/Soundengine/DSPAudio/modulationNode.c`，`modNode_setOriginalValueChanged()`：调制目标 0 没有指针，真机在这里会读地址 0（ITCM，能读），PC 上会崩。加了和 `modNode_setDestination()` 里固件自己已有的一样的 `if(!p->ptr) return;`。读到的值本来就不会被写回（所有写入都先检查 `p->ptr`），所以行为不变。

## 实现记录

### P0（本机构建）—— 已完成

构建和运行：

```
cmake -S emu -B build/emu -DCMAKE_C_COMPILER=clang
cmake --build build/emu
build/emu/lxr_cli render --demo --out demo.wav     # 2 小节演示节奏
build/emu/lxr_cli selftest                          # 不静音 + 同种子逐字节相同 + 不同种子不同
ctest --test-dir build/emu
```

结构（和第 4 节的建议基本一致）：

- `emu/shim/`：同名头文件，放在 include 路径最前面，替掉 `main.h`、`stm32f7xx_hal.h`、`stm32f7xx.h`、`usbd_cdc.h`、`usbd_cdc_if.h`。外设寄存器就是内存里的结构体；`__SSAT`、`__QADD16`、`__PKHBT`、`__CLZ` 等用 C 写了等价实现，`__SSAT` 对浮点参数按 ARM VCVT 的方式饱和转换。
- `emu/hw/`：`hal_emu.c`（GPIO、定时器、SPI 移位寄存器 = 虚拟按键和 LED、可设种子的 xorshift32 代替硬件 RNG、时间），`lcd_emu.c`（HD44780 模型，替掉 `lcd.c`），`sd_emu.c`（虚拟 SD 卡），`usb_emu.c`（USB-MIDI 队列）。
- `emu/platform.c`：替掉 `main.c` 和 `stm32f7xx_it.c`。按原顺序开机；之后每 64 帧跑一次 TIM14、SysTick、DMA 半传输和一遍主循环。
- `emu/api.c` + `emu/lxr_api.h`：C API。`emu/cli/lxr_cli.c`：命令行工具。
- 除 `main.c`、`stm32f7xx_it.c`、CubeMX 初始化、`flash_if.c`、`lcd.c`、`cs4344_cs5343.c` 和 USB 协议栈外，固件源码全部原样编译，FatFs 也一样。

和第 3 节计划不同的决定：

- **SD 卡用固件自带的 FatFs，而不是映射到 POSIX。** 虚拟卡是一块稀疏的内存盘（512 字节扇区，用到才分配），上面跑固件自己的 `ff.c` 和 `ffconf.h`。这样 8.3 文件名、大小写、目录顺序、`f_chdir` 相对路径都和真机一模一样，本机和 WASM 也是同一份代码，不需要 MEMFS。导入导出时用 FatFs 读写卡里的文件即可（P1 做）。
- **时钟按真机的精确比例走，不按 44100。** I2S 实际采样率 = 22.6 MHz / 512 = 44140.625 Hz（和 `REAL_FS` 一致），TIM14 = 108 MHz / 13501 / 2 = 3999.70 Hz，SysTick = 1 kHz。用整数累加，每个采样对应的 tick 数和真机完全相同，所以渲染出的采样流和真机逐样本对应；浏览器按 44100 播放时会慢 0.09%（约 1.6 音分）。
- **LCD 在 API 层模拟**（`lcd.h` 的函数接到 HD44780 模型上），不在 GPIO 层。非阻塞版本一次调用就完成。
- **一个进程只能开机一次**（`lxr_init` 第二次调用返回 -2）。固件状态都在全局变量里，只有真正“断电”才能清零；WASM 端要重启就重新实例化模块。

模拟器格式化空卡时和真机不同的一点：

- 真机的 `sd_formatRoutine()` 在 `soundengine_init()` 之前运行，所以工程 0 里存的 pattern 全是 0，音轨长度也是 0。音序器随后会算 `x % 0`：ARM 的 UDIV 除零返回 0（不报错），x86 和 WASM 会崩。模拟器格式化时先调一次 `seq_init()`，存进去的是清空的 16 步 pattern。

已知差异和注意事项：

- **整数除零**：ARM 返回 0，x86/WASM 会崩。正常数据（长度 ≥ 1）不会触发；如果真机卡上有长度为 0 的音轨，模拟器会崩。真碰到了再处理。
- **浮点转整数溢出**：ARM 饱和，x86 得到 0x80000000，WASM 默认饱和。只在溢出时有差别，P5 A/B 时留意。
- **`-ffast-math`**：固件在 ARM 上用 `-ffast-math` 编译，模拟器用的是默认的 IEEE 语义。P5 A/B 时可能会看到很小的差别。
- **flush-to-zero**：`soundengine_init()` 打开了 FZ，主机上没有。非规格化数只影响极小的值，听不出来，但会影响逐位对比。
- **`__fp16`**：混响/延时缓冲区用半精度浮点存储，需要 clang（gcc 在 x86 上不支持 `__fp16`）。
- **输出接口**：`mixer.c` 把 `MIXER_ROUTING_DAC1_*`（Out 1）写进它的 `output2` 参数，也就是 `dma_buffer2`。插孔检测脚为高电平表示插了线，没插线的输出会被固件改送到别的输出。默认只插 Out 1；`lxr_set_jacks()` 可以改。
- **推子**：LXR-02 有 6 个音量推子，固件经 ADC 读取。虚拟推子默认推满（`emu_set_fader()`）。
- **性能**：本机 -O2 渲染 64 秒音频耗时 0.87 秒，约为实时速度的 73 倍。

### Web App（虚拟前面板）—— 第一版

用户要求先做 Web App（P1 的 SD 卡往返暂缓）。现在的状态：

```
cd web
npm ci
npm run wasm      # 用 clang 编译 emu/ 到 public/lxr_emu.wasm
npm run dev       # 本地开发；npm run build 生成 dist/
```

- **WASM 不用 Emscripten**：clang 18 直接编译到 `wasm32-wasi`（`emu/cmake/wasi-clang.cmake`，Ubuntu 包 `clang lld wasi-libc libclang-rt-18-dev-wasm32`），生成一个约 400 KB 的 reactor 模块，只导出 `lxr_*` API。模块只需要 3 个 WASI 函数（`fd_write`、`fd_seek`、`fd_close`），在 AudioWorklet 里给几个空实现就行，不需要胶水 JS。
- **`web/public/lxr-processor.js`**：AudioWorklet 处理器，在音频线程里实例化 WASM，每 128 帧调用 `lxr_render`，约 86 Hz 回传 LCD/LED 状态（有变化才发）。
- **`web/src/`**：Vite + TypeScript，没有框架。`lcd.ts` 用 HD44780 A00 字库（取自 char-lcd，MIT）画 5×8 点阵，CGRAM 自定义字符和光标都按显示 RAM 画；`controls.ts` 是按键、无级旋钮、DATA 编码器和推子；`main.ts` 负责布局和键盘快捷键。
- **输入都走硬件信号**：按键经虚拟移位寄存器（`IO/DIO.c` 读）；DATA 编码器在 SysTick 里逐个输出正交相位，由固件的 `encoder.c` 解码（一格 = 4 次相位变化，按钮至少保持 60 ms，满足固件的去抖）；4 个旋钮按双滑臂 360° 电位器模拟 ADC 读数（`calcPosition()` 的反函数），每 2° 对应一个参数步进，菜单类参数要转 16°，和真机一样；6 个推子写 ADC 通道 8–13。
- **`.github/workflows/pages.yml`**：构建本机版并跑自测、构建 WASM 和网页、部署到 GitHub Pages。需要在仓库 Settings > Pages 里把 Source 设成 "GitHub Actions"。
- **Chromium 实测**（无头 Playwright）：开机 16–30 ms；编码器、旋钮、按键、START 都能驱动固件菜单和音序器；音频线程负载几个百分点（`Date.now()` 只有毫秒精度，读数会跳）。

这一阶段发现并修复的平台差异：

- **浮点转整数**：FM/PWM 振荡器把负数和超过 2³² 的相位偏移转成 `uint32_t`。ARM 的 VCVT 会饱和（负数变 0，溢出取 0xFFFFFFFF），x86 回绕，WASM 默认返回 0，三者听起来都不一样。现在 `lxr_core` 用 `-fno-strict-float-cast-overflow` 编译，32 位转换按饱和规则来，和 ARM 一致；本机版和 WASM 版的输出逐样本相同。仍有一点不同：浮点直接转 16 位整数时，ARM 先饱和到 32 位再截断，clang 直接饱和到 16 位，只在数值超出 ±32767 时有差别。
- **`CodecInit`**：`Soundengine.c` 带一个参数调用它，`AudioCodecManager.c` 的定义却没有参数。ARM 上没事，WASM 里这种调用会 trap。`AudioCodecManager.c`（声卡初始化和 DMA 缓冲区）已换成 `emu/platform.c` 里签名匹配的版本。
- **`delay.c`** 里有 ARM 内联汇编，换成了 `hal_emu.c` 里的 `DWT_Delay_Init()`。

### 虚拟 SD 卡保存到浏览器 —— 已完成

- `emu/hw/sd_emu.c` 记录哪些 64 KB 块被写过。API 新增 `lxr_sd_create()` + `lxr_boot()`（`lxr_init()` 等于两者连用），中间可以用 `lxr_sd_chunk_for_load()` 装回保存的块；`lxr_sd_take_dirty()` 和 `lxr_sd_chunk()` 取出写过的块。
- AudioWorklet 每 0.5 秒把脏块交给页面；页面（`web/src/sdStore.ts`）存进 IndexedDB（库 `lxr02-emu`，表 `sd-card`，键是块号）。开机时把所有块交给 AudioWorklet，装回后再开机。
- "重启"先把最新的块同步回来再开机，卡上内容保留；"清空 SD 卡"删掉所有块再开机，固件会格式化一张新卡。
- 格式化加开机一共写了 14 个块（约 0.9 MB）；之后每次自动存盘通常只写 1–2 块。
- 固件自己会在停手 2 秒（`PRESET_SAVE_TIME`）后把当前 kit/pattern 存到 `/tmp`，开机时读回。所以改完 2 秒内刷新页面，和真机断电一样，最后的改动会丢。
- Chromium 实测：改参数和步、刷新页面、重启都能保留；清空后回到出厂状态。

还没做（下一步候选）：导入/导出真机 SD 卡（选择文件夹或 zip）；第二组输出（Out 2）；Web MIDI；参数编辑器和步进网格（P3）。

### 公开发布前的授权要求（NOTICE.md）

固件是 GPL-3.0-only，`NOTICE.md` 按 GPL 第 7 条附加了两项条款，模拟器这样处理：

- **7(c) 修改版要标明**：开机画面必须显示固件被改过。`emu/platform.c` 把 `main.c` 的 "Sonic Potions / LXR2 Drums V 1.7" 换成了 "Unofficial Emu / based on fw 1.7"，并停留 1.5 秒（模拟器时间，`SPLASH_MS`），然后才把屏幕交给菜单。网页底部也写明是非官方修改版。
- **7(e) 商标**："Erica Synths"、"LXR"、"LXR-02" 不能用在让人以为来自 Erica Synths、或经其认可的地方；如实说明兼容性可以，例如 "custom firmware for the Erica Synths LXR-02"。网页和 README 都写了 "not affiliated with or approved by Erica Synths"。项目名 "LXR-02 Emu" 本身带商标，公开推广前最好换一个自己的名字（待 Qiang 决定）。
- **GPL 源代码**：网页底部链接到构建所用的源代码（`emu` 分支）。
- **硬件外观**：面板、外壳和工业设计不在 GPL 范围内，不能复制。网页面板是自己设计的通用布局，没有用 Erica Synths 的外观、logo 或面板印刷。

### 界面语言

网页默认英文；浏览器的第一语言是中文（`zh` 开头，简繁都算）时显示中文。右上角的语言按钮可以就地切换，不打断正在运行的模拟器；选择保存在 `localStorage`，存不了就每次按浏览器语言来。所有文字在 `web/src/i18n.ts`，目前只有英文和简体中文。

### GitHub Pages 的设置

Settings → Pages → Source 必须是 **GitHub Actions**。设成"Deploy from a branch"时，GitHub 会在每次推送时把分支原样发布（首页是 README），覆盖模拟器网页；2026-10-28 就因此让网址打开成了 README，被网友发现。改正后，每次更新都要打开线上页面确认。

### SD 卡导入/导出 —— 已完成（P1 的往返部分）

- `emu/card_io.c`：全部经过固件自己的 FatFs。
  - **导出**：在固件运行时、两次渲染之间进行，在固件挂载的卷上按广度优先列出所有文件和目录，再逐个读出。只用绝对路径，不动固件的当前目录。
  - **导入**：在开机前进行。先按固件格式化例程的参数（`FM_FAT32`，簇大小用默认值）格式化，再逐个写入文件，然后开机。
- 网页上的"SD 卡…"对话框（`web/src/cardDialog.ts`、`cardFiles.ts`）：
  - 导出到文件夹：用 File System Access API，可以直接选中 Mac 上插着的 SD 卡；同名文件覆盖，其他文件保留。
  - 下载 zip：zip 用的是自己写的 store 格式和 CRC32。
  - 从文件夹或 zip 导入：zip 支持 store 和 deflate（解压用浏览器的 `DecompressionStream`）。外层只有一个文件夹时，把它当成卡的根目录；`__MACOSX`、`.DS_Store`、`System Volume Information` 等会被跳过。导入会替换整张虚拟卡，并清掉浏览器里存的旧卡。
- 新建虚拟卡的容量改成 256 MB。卡是稀疏的，空间用到才分配；以前格式化的卡还是原来的文件系统大小。
- 格式化加开机后，卡上有：`/GLO.CFG`、`/PROJ.IDX`、`/PROJ00/`（`PRJ.NFO`、`GLO.CFG`，以及 64 组 `NN-.SND`/`.PAT`/`.SNG`，第 0 组 kit 叫 `00-INITK.SND`）、`/TMP/`（自动存盘的 `TMP.SND`、`TMP.PAT`）。
- 测试（Node 和 Chromium）：
  - 导出、导入、再导出：Node 里 200 个条目、Chromium 里 199 个，逐字节相同，步和参数也都还原；
  - 写入文件夹再读回（用浏览器的私有文件系统测）：结果一致；
  - Finder 风格的 zip 导入正常。
- 还没做：用 Qiang 真机 SD 卡的拷贝做往返测试；把导出的卡插回真机验证能否读取。

### 新界面第一步：音序器 —— 已完成

和 Qiang 讨论后，新界面分两块：音序器（上）和音色设置（下，第二步再做），尺寸按 Mac 上的 Chrome 设计，常用操作偏向 Techno。第一步只做音序器。真机面板保留在下面。

- **固件这边（`emu/seq_api.c`）**：直接读写固件自己的 `seq_patternSet`，写法和前面板的步进编辑一样（`seq_setMainStep()` 开关步，`Step`/`StepTiming` 的字段直接赋值，然后 `preset_touchTimer(PRESET_PAT_TIMER)`，2 秒后固件自己存到 `/TMP/TMP.PAT`）。换 pattern 走 `SEQ_CHANGE_PAT`，和 pattern 按键相同。
  - 快照：20 字节头（显示的 pattern、正在播放的、待切换的、是否在播放、静音位、pattern 存的 swing、kit、BPM、7 个轨道长度、当前 swing、"有未保存改动"），后面是 7 轨 × 64 步、每步 12 字节。AudioWorklet 每 8 个 quantum（约 23 ms）比较一次，有变化才发给页面，所以面板上的改动也会出现在网格里。
  - 页面的每次修改带编号，快照带上已经处理到的编号；页面不理会比自己发出的修改更旧的快照，避免拖动时闪回。
- **真机的一个行为（`seq_setPendingPatternActive()`）**：正在播放的 pattern 改完不保存就切走，固件会用开始播放时的备份（`patternBackupBuffer`）把它还原，改动就没了，只有 SAVE 才会保留。网页上照样保留这个行为，但加了"保留修改"开关（默认打开，存在 `localStorage`）：
  - 打开时，在切换真正发生之前，把当前的工作副本复制成备份（`seq_copyPatternToBackupBuffer()`，在 `emu_render_block()` 一开始调用 `seq_api_block()`，因为切换只在 `seq_tick()` 里发生，页面的修改只在两个 block 之间到达）；切换完成后再像 SAVE 一样写一次 pattern 文件（`preset_savePatternSD()`，写进当前目录，也就是 `/TMP`）。
  - 关掉时和真机完全一样。
  - "保存"按钮（⌘S）等于 SAVE 页存到当前槽位：`seq_patternSet.shuffle` ← 当前 swing，`preset_savePatternRAM()`，`preset_savePatternSD()`。没有照搬按键处理里的 `SKIP_NEXT_KIT_AUTOLOAD`，因为那是给存到别的槽位用的，存到当前槽位时会让下一次换 pattern 不加载 kit。
  - swing（`PAR_SHUFFLE`=261）固件是按 pattern 存的，但只在 SAVE 时写回 pattern；网页改 swing 时同时写 `seq_patternSet.shuffle[pattern]` 和当前值，切回来时还在。BPM（`PAR_BPM`=272，0 = 外部时钟，1 = MIDI 时钟）走 `menu_parseGlobalParam()`，和面板一样；BPM 不在自动存盘里，重启后回到工程里存的值（和真机一样）。
  - Node 测试：关掉"保留修改"时，A1 → A2 → A1 后改动消失（和真机一致）；打开时保留，并出现 `/TMP/00-.PAT`；播放中请求切换后、切换前的改动也保留；保存后切走再切回，步和 swing 都在。
- **网页（`web/src/seq/`）**：`model.ts` 解析快照；`sequencer.ts` 是界面：
  - 工具栏：播放/停止（按 START 键）、BPM（输入、滚轮、Tap）、swing、pattern（A1–D16 弹出选择、前后切换、播放中显示"下一个"并闪烁）、"已修改"、保存、保留修改、撤销/重做。
  - 4 小节总览条（7 轨 × 64 步，带播放头），点击选小节；"跟随"让显示跟着播放的小节走。
  - 7 轨网格：点击开关，拖动连续画（同一轨），Shift 点击或右键只选中；亮度表示力度，角上显示概率、retrig、参数锁，底部小条表示微移；超出轨道长度的步变暗；每轨有自己的播放头（轨道长度可以不同）。
  - 轨道头：点名字试听并选中，M/S（独奏是用静音实现的，⌘ 点击可独奏多轨），长度 1–64，菜单里有每拍/每八分/反拍/每十六分填充、左右移、力度随机微调、复制/粘贴/清空。
  - 下方 lane：给选中的轨道画力度、概率、retrig、微移、音高，双击恢复默认。
  - （第一版右侧有一个步进检查器，和下方 lane 重复，第二步按 Qiang 的意见换成了音色面板，见下一节。）
  - 撤销只管网页上的修改（最多 200 步）。网格获得焦点时：方向键移动，Shift+方向键扩选，Enter 开关，Delete 关闭，⌘C/⌘V 复制粘贴步，⌘A 选中整页；Space、数字键等其他键仍然给面板。
- Chromium 测试（`/tmp` 里的 Playwright 脚本，1440、1280、900 宽，中英文）：点击、拖动、撤销/重做、菜单填充、lane 画力度和微移、检查器、轨道长度、独奏、BPM/swing、播放头、播放中切换 pattern、切回后改动还在、刷新页面后从卡上读回，都正常，没有页面错误。

### 新界面第二步：音色面板 —— 已完成

Qiang 试用第一版后的意见：网格下方的 lane 对应每一步（力度、概率等），保留；右侧的步进检查器和 lane 重复，换成选中轨道的音色参数；选中别的声部时，参数要能改（之前面板屏幕一直停在 DRUM 1）；要列出真机的 8 个参数页；还要有一个和 LXR-02 一样的屏幕显示参数的符号和数值。

- **固件这边（`emu/param_api.c`）**：`lxr_ui_describe()` 把固件自己的菜单表输出成 JSON：7 个声部页 × 8 个子页 × 8 个位置的参数号（`menuPages`）、名字（`valueNames` 和 `MenuText.h` 的 `shortNames`/`catNames`/`longNames`）、类型（`parameter_dtypes`）、范围（按 `menu_encoderChangeParameter()` 的限制）、显示偏移（粗调类参数显示 `值-60`，其他 ±63 参数显示 `值-63`，和 `menu_repaintGeneric()` 一样）、各菜单的值名称（波形会加上卡上的采样 `s0`、`s1`…）、调制目标表（`modTargets`、`modTargetVoiceOffsets`）。`getMenuItemNameForValue()` 是 static，所以只把菜单号到名称表的对应关系在这里重复了一遍，名称本身仍然来自固件。`lxr_cli describe` 可以在本机打印这份 JSON。
  - 每个子页的参数和面板上 8 个选择键打开的页一致：OSC、AEG、MOD、FM、TRANS、FILTER、LFO、MIX。军鼓没有 FM 页；开镲（声部 7）和闭镲共用大部分参数。MIX 页第二屏的轨道长度、MIDI 通道和音符不是音色参数，网页上不列（长度在音序器里）。
  - `lxr_set_param()` 改 LFO 的目标声部时，现在会像固件那样把目标换成新声部上的同一个参数（`getModTargetGapIndex()` / `getModTargetIdxFromGapIdx()`）。固件用的是上一次编辑目标时记下的 `menu_TargetVoiceGapIndex`，这里用当前目标算，结果在通常情况下相同。Node 测试：LFO1 指向 DRUM 1 的截止频率，换到声部 2/4/5/1，目标跟着变成各自的截止频率。
  - `lxr_select_voice()`：选中轨道时让面板也切到这个声部，方法是按一下它的声部键，但只在这个键只是"选择声部"的时候才按：不在复制模式、没按 SHIFT（会变成静音）、不在 PERF 页（也是静音）、处于 voice 模式。这样真机屏幕和旋钮跟着显示、编辑同一个声部。
  - AudioWorklet 每 8 个 quantum 比较一次全部参数（`lxr_params()`，302 字节），有变化才发给页面，所以面板旋钮和载入 kit 的改动都会出现在音色面板上。页面的参数修改带编号，和音序器一样用编号避免拖动时被旧数据拉回。
- **网页（`web/src/sound/`）**：`editor.ts` 是右侧的音色面板：
  - 顶部：声部名（轨道颜色）和试听按钮。
  - 屏幕：用和面板屏幕相同的 HD44780 点阵画法（`LcdView`），按 `menu_repaintGeneric()` 的格式画：平时上一行是 4 个参数的 3 字母名称（当前参数大写，有第二屏时第 16 列显示 `>` 或 `<`），下一行是 3 字符的数值（`numtostrps`/`numtostrpu`/`setNoteName` 的写法）；正在改的参数显示 1.5 秒的编辑模式（上一行类别和全名，下一行数值，调制目标显示目标的类别和名字）。固件的菜单位置（`menuIndex`、`editModeActive`）是 menu.c 的 static 变量，不改固件就设不了，所以这块屏幕是按同样的格式另画的，不是真机屏幕的镜像。
  - 8 个页按钮（1 OSC … 8 MIX），没有参数的页变灰。
  - 当前页的全部参数：数值用滑条，选项不超过 8 个的菜单用按钮，更多的用下拉列表，开关用开关按钮，调制目标用下拉列表（只列目标声部的参数，和固件的范围一致）。名字用 `labels.ts` 里的可读名称（中英文），旁边小字是固件的 3 字母名称，鼠标停留显示固件原名和参数号。
- Chromium 测试：选择 HH CLS 后标题和 lane 都切换，真机屏幕也换到闭镲；拖动截止频率时固件值同步，屏幕显示 `Filter  Frequncy` 和数值，随后回到 `FRQ res typ drv`；转面板旋钮 1 后音色面板跟着更新；改动 2 秒后自动存盘，刷新页面后还在；中英文切换正常；音序器原有测试全部通过，没有页面错误。
