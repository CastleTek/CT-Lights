#pragma once
#ifdef CASTLETEK_WLED_COMPAT
void castleTekWLEDLoadDefaultLayout(bool filesystemReady);
void castleTekWLEDRegisterDefaultLayoutRoutes();
void castleTekWLEDSerializeDefaultLayoutInfo(JsonObject root);
void castleTekWLEDHandleDefaultLayout();
void castleTekWLEDPrepareDefaultLayoutFactoryReset();
#endif
