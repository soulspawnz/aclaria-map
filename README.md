# Aclaria Map

A public, mobile-first interactive companion map for **Aclaria RPG** (formerly *Niiiny-RPG*). 

🔗 **Live Map:** [https://soulspawnz.github.io/aclaria-map/](https://soulspawnz.github.io/aclaria-map/) *(pending Task C deployment)*  
📖 **Wiki Hub:** [Aclaria RPG Fandom Wiki](https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market)

---

## Scope & Layers

- **Housing (Active):** All 26 estates from the [Grand Homestead Market](https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market) in original catalogue order, mapped across 19 approximate regions/cities with search, filtering, and companion capacity details.
- **Explorations & Dungeons (Planned):** The schema (`data/housing.json`) is structured for extensible layers so expedition destinations (where travel times scale by active house proximity and companion perks) and dungeon locations can be toggled on as verified data is integrated.

## Evidence & Placement

- **Official Artwork:** `assets/aclaria-map.jpg` (`4096×2983`) is the unmodified public world map from the [Aclaria RPG Wiki](https://aclariarpg.fandom.com/wiki/File:Aclaria_world_map.jpg).
- **Catalogue Data:** House names, Gold prices, companion capacities, and location descriptions come directly from the [Grand Homestead Market catalogue](https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market).
- **Approximate Regions:** Numbered markers (`1–19`) represent approximate city or regional placements with uncertainty radii, not exact estate coordinates. Each marker records whether it is a settlement (`approximate-city`) or a broader landform area (`approximate-region`).
- **Placed with caveats:** **Pine Estate (`Erethune`)** is placed at the *Erethune* settlement label on the northern lake, read directly from the map at about 0.540, 0.171. **Karnethra** sits on the settlement icon rather than the shoreline.
- **Map label spelling:** The map reads *HEARTHGLEN*; the market card keeps its own wording (*Hearthglem*). The area name follows the map, the house card stays verbatim.
- **Unplaced Estates (1/26):**
  - **Lovely Cabin (`Thaldris`):** Remains unplaced. A *Thaldris*-like label appears in the northern snow range, but the reading was not confirmed to the placement standard used for the mapped areas, and it is not assumed to mean *Thalvaris*.

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
