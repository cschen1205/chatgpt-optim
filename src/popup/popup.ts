import { normalizeSettings, readSettings } from "../content/settings";
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = el<HTMLOutputElement>("status");
async function activeMessage(type: string) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error("No active tab");
  return chrome.tabs.sendMessage(tab.id, { type });
}
async function refresh() {
  try {
    const d = await activeMessage("diagnostics");
    status.value = `Managed: ${d.managed}\nActive/near: ${d.near}\nParked: ${d.parked}\n${d.reason}`;
  } catch {
    status.value =
      "Inactive on this page. Open or reload a supported ChatGPT conversation.";
  }
}
void readSettings()
  .then((s) => {
    el<HTMLInputElement>("enabled").checked = s.enabled;
    el<HTMLSelectElement>("mode").value = s.mode;
    el<HTMLInputElement>("restore").value = String(s.restoreBufferScreens);
    el<HTMLInputElement>("park").value = String(s.parkBufferScreens);
    return refresh();
  })
  .catch(() => {
    status.value = "Unable to read settings.";
  });
el<HTMLFormElement>("settings").addEventListener("submit", (e) => {
  e.preventDefault();
  const settings = normalizeSettings({
    enabled: el<HTMLInputElement>("enabled").checked,
    mode: el<HTMLSelectElement>("mode").value as "balanced" | "strong",
    restoreBufferScreens: el<HTMLInputElement>("restore").valueAsNumber,
    parkBufferScreens: el<HTMLInputElement>("park").valueAsNumber,
  });
  void chrome.storage.local
    .set({ settings })
    .then(() => {
      el<HTMLInputElement>("park").value = String(settings.parkBufferScreens);
      status.value = "Saved.";
    })
    .catch(() => {
      status.value = "Unable to save settings.";
    });
});
el("restore-all").addEventListener("click", () => {
  void activeMessage("restore")
    .then(refresh)
    .catch(() => {
      status.value = "No active optimizer on this page.";
    });
});
