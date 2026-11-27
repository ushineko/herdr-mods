// herdr-mods (spec 017): a Jupyter notebook (.ipynb), shown as the Markdown viewer
// shows a document: lib/notebook.js turns its cells and outputs into Markdown, and
// its pictures (plots) are cached from their base64 and drawn between the blocks.
// Raw shows that Markdown. A file that isn't a notebook says why.
import markdown, { loadText } from "./markdown.js";
import { readText } from "./text.js";
import { notebookToMarkdown } from "../lib/notebook.js";
import { stageData } from "../media.js";

export default {
  id: "notebook",
  async load(file, env, previous) {
    let nb;
    try { nb = JSON.parse(await readText(file, env.on)); } catch (e) { throw new Error(`Not a notebook: ${e?.message ?? e}`); }
    const { markdown: md, images } = notebookToMarkdown(nb);
    return loadText(md, file, env, previous, (ref) => {
      const img = images[Number(ref)];
      return img ? stageData(img.ext, img.data) : Promise.reject(new Error("missing picture"));
    });
  },
  start: markdown.start,
  toolbar: markdown.toolbar,
  render: markdown.render,
  release: markdown.release,
};
