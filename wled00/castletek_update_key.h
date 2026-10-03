#pragma once
#include <stdint.h>
#include <stddef.h>

// Fixed Compatibility v1 app-key verifier; the raw app key is not stored here.
static constexpr size_t castleTekUpdateKeyLength = 64;
static constexpr uint8_t castleTekUpdateKeyDigest[32] = {0,122,84,141,220,122,156,40,208,16,222,170,96,73,163,180,213,96,152,36,132,121,225,198,108,137,63,165,179,196,20,43};
