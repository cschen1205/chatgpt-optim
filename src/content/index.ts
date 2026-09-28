import { normalizeSettings, readSettings } from "./settings";
import { OptimizerController } from "./controller";
void readSettings()
  .then(async (settings) => {
    const controller = new OptimizerController(settings);
    await controller.start();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings)
        controller.updateSettings(normalizeSettings(changes.settings.newValue));
    });
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (message?.type === "restore") {
        controller.restoreAll();
        respond({ ok: true });
      }
      if (message?.type === "diagnostics") respond(controller.getDiagnostics());
    });
  })
  .catch(() => {
    /* Fail open when storage or extension context is unavailable. */
  });
