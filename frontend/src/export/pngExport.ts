import html2canvas from "html2canvas";

/**
 * Screenshots a DOM node to a PNG and triggers a browser download. This is
 * the MVP's "PNG export" — a canvas screenshot of whatever's currently on
 * screen (the dashboard canvas, the profiling view, or the raw data table),
 * not a server-rendered export. PDF/sharing/public links are explicitly out
 * of scope for this milestone.
 */
export async function exportNodeToPng(node: HTMLElement, filename: string): Promise<void> {
  // Read the app's current background so the PNG isn't rendered on a
  // transparent (checkerboard-looking) canvas in an image viewer — the same
  // color the page itself sits on, in either theme.
  const backgroundColor =
    getComputedStyle(document.documentElement).getPropertyValue("--color-background").trim() ||
    "#ffffff";

  const canvas = await html2canvas(node, {
    backgroundColor,
    useCORS: true,
    scale: Math.min(2, window.devicePixelRatio || 1),
  });

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Failed to render the page to an image.");
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
