// landing-class.js — "Choose your class" card on the home page. The choice is saved on this device only.
import { getMyClass, setMyClass, classLabel, renderPicker, esc } from "./classopts.js";

const root = document.getElementById("classpick");
if (root) {
  const done = () => {
    root.innerHTML = `<div class="cp-done">
      <span class="cp-check" aria-hidden="true">✓</span>
      <div class="cp-info"><p class="cp-title">Your class</p><p class="cp-class">${esc(classLabel(getMyClass()))}</p></div>
      <a class="cp-go" href="app.html#myclass">Open my class →</a>
      <button type="button" class="cp-change">Change</button></div>`;
    root.querySelector(".cp-change").addEventListener("click", edit);
  };
  
  const edit = async () => {
    root.innerHTML = `<p class="cp-title">Choose your class</p>
      <p class="cp-hint">We show your timetable, your teachers and updates for your class first. It is saved on this device only.</p>
      <div id="cp-mount"></div>
      <div class="cp-actions"><button type="button" class="cp-save" disabled>Save my class</button>${getMyClass() ? '<button type="button" class="cp-change" id="cp-cancel">Cancel</button>' : ""}</div>`;
    const save = root.querySelector(".cp-save");
    const pick = await renderPicker(root.querySelector("#cp-mount"), (ok) => { save.disabled = !ok; });
    save.addEventListener("click", () => { const v = pick.value(); if (v) { setMyClass(v); done(); } });
    const cancel = root.querySelector("#cp-cancel"); if (cancel) cancel.addEventListener("click", done);
  };
  getMyClass() ? done() : edit();
}
