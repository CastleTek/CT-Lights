#pragma once
#ifdef CASTLETEK_WLED_COMPAT
void castleTekWLEDRegisterPresetNameRoutes();
void castleTekWLEDSerializePresetNameInfo(JsonObject root);
void castleTekWLEDHandlePresetName();
int castleTekWLEDInstallPresetUpload(const String& temporary);
int castleTekWLEDDeletePresetsFile();
void castleTekWLEDPreparePresetNameFactoryReset();
#endif
