import { loadAllTimesRoster, portraitPath } from "./lib.js";

const galleryEl = document.getElementById("charGallery");
const statusEl = document.getElementById("galleryStatus");

async function loadGallery() {
  statusEl.textContent = "Loading…";
  try {
    const ctx = await loadAllTimesRoster();
    statusEl.textContent = "";
    renderGallery(ctx.roster);
  } catch (e) {
    console.error(e);
    statusEl.textContent = String(e?.message ?? e);
  }
}

function renderGallery(roster) {
  galleryEl.innerHTML = "";
  for (const r of roster) {
    const href = `./character.html?char=${encodeURIComponent(r.name)}`;
    const card = document.createElement("a");
    card.className = "char-card";
    card.href = href;
    card.innerHTML = `
      <img class="char-card-portrait" src="${portraitPath(r.name)}" alt="${r.name}" onerror="this.style.display='none'">
      <div class="char-card-info">
        <span class="char-card-rank">#${r.rank ?? "?"}</span>
        <span class="char-card-name">${r.name}</span>
      </div>
    `;
    galleryEl.appendChild(card);
  }
}

loadGallery();
