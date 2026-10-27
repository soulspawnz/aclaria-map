# Aclaria Map

A public, mobile-first interactive companion map for **Aclaria RPG** (formerly *Niiiny-RPG*). 

🔗 **Live Map:** [https://soulspawnz.github.io/aclaria-map/](https://soulspawnz.github.io/aclaria-map/) *(pending Task C deployment)*  
📖 **Wiki Hub:** [Aclaria RPG Fandom Wiki](https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market)

---

## Scope & Layers

- **Housing (Active):** All 26 estates from the [Grand Homestead Market](https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market) in original catalogue order, mapped across 18 approximate regions/cities with search, filtering, and companion capacity details.
- **Explorations & Dungeons (Planned):** The schema (`data/housing.json`) is structured for extensible layers so expedition destinations (where travel times scale by active house proximity and companion perks) and dungeon locations can be toggled on as verified data is integrated.

## Evidence & Placement

- **Official Artwork:** `assets/aclaria-map.jpg` (`4096×2983`) is the unmodified public world map from the [Aclaria RPG Wiki](https://aclariarpg.fandom.com/wiki/File:Aclaria_world_map.jpg).
- **Catalogue Data:** House names, Gold prices, companion capacities, and location descriptions come directly from the [Grand Homestead Market catalogue](https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market).
- **Approximate Regions:** Numbered markers (`1–18`) represent approximate city or regional placements with uncertainty radii, not exact estate coordinates.
- **Unplaced Estates (2/26):**
  - **Pine Estate (`Erethune`):** Remains unplaced as *Erethune* has no confidently identified label on the current world map.
  - **Lovely Cabin (`Thaldris`):** Remains unplaced as *Thaldris* has no confidently identified map label (and is not assumed to be *Thalvaris*).

## Repository Structure

- `index.html` / `styles.css` / `app.js`: Static, dependency-free mobile-first map interface with touch/keyboard pan-and-zoom.
- `assets/aclaria-map.jpg`: Original public wiki world map, byte-identical.
- `data/housing.json`: Normalized coordinates, uncertainty ellipses, layer definitions, and market metadata.
- **Pipeline & Tooling:** Initial prototype, data normalization, and task orchestration by **GPT-6.1 Sol Light**. Static site implementation, independent dataset/placement auditing, testing, and GitHub Pages deployment are executed via **Hermes Kanban** (`DeepSeekV4.1Flash1017/OpenRouter Ultra`).

## Credits

Aclaria RPG and all associated world maps and artwork belong to **niiiny** and their respective creators.
- **Official Discord Server:** [Join Aclaria RPG](https://discord.gg/CV3QrrdJSK)
- **Original Game Asset Repository:** [niinybot-hash/rpg-icons](https://github.com/niinybot-hash/rpg-icons)

No additional license for game artwork is asserted in this repository.
