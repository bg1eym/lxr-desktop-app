# LXR-02 Emu (unofficial) - toolchain for a wasm32-wasi build with plain clang.
#
#   cmake -S emu -B build/emu-wasm -DCMAKE_TOOLCHAIN_FILE=emu/cmake/wasi-clang.cmake
#
# Needs clang, wasm-ld, the wasm32 compiler-rt builtins and wasi-libc
# (Ubuntu: clang lld wasi-libc libclang-rt-dev-wasm32). WASI_SYSROOT points
# at the sysroot; Ubuntu installs it under /usr.
# SPDX-License-Identifier: GPL-3.0-only
set(CMAKE_SYSTEM_NAME Generic)   # CMake has no WASI platform module
set(CMAKE_SYSTEM_PROCESSOR wasm32)
set(triple wasm32-wasi)

if(NOT CMAKE_C_COMPILER)
    find_program(CMAKE_C_COMPILER NAMES clang-18 clang REQUIRED)
endif()
set(CMAKE_C_COMPILER_TARGET ${triple})
set(WASI_SYSROOT "/usr" CACHE PATH "wasi-libc sysroot")
set(CMAKE_SYSROOT ${WASI_SYSROOT})
set(CMAKE_C_FLAGS_INIT "-isystem ${WASI_SYSROOT}/include/${triple}")
set(CMAKE_EXE_LINKER_FLAGS_INIT "-fuse-ld=lld -L${WASI_SYSROOT}/lib/${triple}")
set(CMAKE_EXECUTABLE_SUFFIX ".wasm")
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
