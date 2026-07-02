# มะพร้าว (maprao)

Generates black-and-white manga-style 4-panel comic strips from a user-supplied story prompt, starring a single fixed mascot, and posts them to Facebook after Telegram approval.

## Language

**Mascot**:
The single, fixed chibi-bunny character that appears in every Comic Strip. Identity is locked across Panels via a Mascot Ref image. There is exactly one Mascot — it is not user-configurable or swappable.
_Avoid_: Character (that term belongs to มะปราง's user-defined, multi-character roster in `characters.json` — a different concept)

**Mascot Ref**:
The anchor image used to lock the Mascot's identity across every Panel of a Comic Strip, generated once via ComfyUI and reused for all future generations (not regenerated per job).
_Avoid_: char_ref, anime_ref (มะปราง-specific terms for its own anchor mechanism)

**Story Prompt**:
The free-text description a user types to start a generation job. It is the sole input to the pipeline — มะพร้าว has no scheduled or automatically-sourced input.
_Avoid_: topic, story (too vague — Story Prompt specifically means the raw user input, not the LLM-expanded Panel content)

**Comic Strip**:
The complete 4-panel, 2×2 grid image produced by one generation job — the unit of output that gets sent for Telegram approval and posted to Facebook.
_Avoid_: post, video (other agents' artifact types; มะพร้าว only ever produces one kind of artifact)

**Panel**:
One of the 4 fixed cells in a Comic Strip's 2×2 grid, each depicting one moment of the story. Panel count is fixed at 4 (not configurable).

**Panel Role**:
The narrative function assigned to each of the 4 Panels in sequence: hook, develop, climax, punchline (convention shared with มะปราง's comic-gen).

**Bubble**:
A speech or thought callout rendered inside a Panel, containing at most one line of dialogue or narration. A Panel has zero or one Bubble — never more. Position is a fixed corner of the Panel (chosen by the LLM, not computed from image content).
_Avoid_: caption band (มะปราง's under-panel text mechanism — มะพร้าว does not use it)

**Footer Caption**:
The single closing line of text rendered below the full 2×2 grid, summarizing the story's mood at the end of the Comic Strip.
