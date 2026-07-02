# Context Map

## Contexts

- [มะพร้าว (maprao)](./agents/maprao/docs/CONTEXT.md) — generates black-and-white manga-style 4-panel comic strips starring a fixed mascot, then posts them to Facebook via Telegram approval

Other agents in this repo (มะลิ, มะนาว, มะกรูด, น้ำข้าว, มะม่วง, มะปราง, anime) do not yet have a `CONTEXT.md`. Add them here as their domain vocabulary gets modeled.

## Relationships

- **มะพร้าว → มะปราง**: มะพร้าว reuses มะปราง's Flux Kontext ComfyUI workflow and Telegram bot token, but owns a separate Mascot (not a มะปราง Character) and a separate gallery/pipeline.
