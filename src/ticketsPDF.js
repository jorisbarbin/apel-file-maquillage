// PDF léger produit localement : prénom et numéro uniquement, aucun jeton, QR code ni position.
// Helvetica/WinAnsi permet les accents français courants sans dépendance externe.
function pdfLiteral(input) {
  const text = String(input).normalize("NFC");
  return "(" + Array.from(text).map((c) => {
    const cp = c.codePointAt(0);
    if (c === "(" || c === ")" || c === "\\") return "\\" + c;
    if (cp >= 32 && cp <= 126) return c;
    if (cp >= 160 && cp <= 255) return "\\" + cp.toString(8).padStart(3, "0");
    return "?";
  }).join("") + ")";
}
export function telechargerTicketsPDF(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) return;
  const safe = tickets.filter((t) => Number.isSafeInteger(Number(t.numero)) &&
    Number(t.numero) > 0 && typeof t.prenom === "string").slice(0, 100);
  if (!safe.length) return;

  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add("");
  const pages = add("");
  const fontNormal = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pagesRefs = [];
  for (let offset = 0; offset < safe.length; offset += 10) {
    const portion = safe.slice(offset, offset + 10);
    const contents = ["BT /F2 19 Tf 48 786 Td " + pdfLiteral("Le coin des petits lutins") + " Tj ET"];
    portion.forEach((t, i) => {
      const y = 720 - i * 65;
      contents.push("BT /F1 14 Tf 48 " + y + " Td " + pdfLiteral("Prénom : " + t.prenom) + " Tj ET");
      contents.push("BT /F2 17 Tf 390 " + y + " Td " + pdfLiteral("N° " + String(t.numero).padStart(3, "0")) + " Tj ET");
    });
    const stream = contents.join("\n") + "\n";
    const contentRef = add("<< /Length " + stream.length + " >>\nstream\n" + stream + "endstream");
    const pageRef = add("<< /Type /Page /Parent " + pages + " 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 " + fontNormal + " 0 R /F2 " + fontBold + " 0 R >> >> /Contents " + contentRef + " 0 R >>");
    pagesRefs.push(pageRef);
  }
  objects[catalog - 1] = "<< /Type /Catalog /Pages " + pages + " 0 R >>";
  objects[pages - 1] = "<< /Type /Pages /Kids [" + pagesRefs.map((r) => r + " 0 R").join(" ") + "] /Count " + pagesRefs.length + " >>";
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += (i + 1) + " 0 obj\n" + body + "\nendobj\n";
  });
  const startXref = pdf.length;
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  offsets.slice(1).forEach((p) => { pdf += String(p).padStart(10, "0") + " 00000 n \n"; });
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root " + catalog + " 0 R >>\nstartxref\n" + startXref + "\n%%EOF";
  const bytes = Uint8Array.from(pdf, (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "tickets-petits-lutins.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
