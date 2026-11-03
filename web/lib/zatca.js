// ZATCA e-invoicing (Fatoora). Rules and sources are in docs/billing-zatca.md (verify with your accountant).
//   Phase 1 (generation): every tax invoice of a VAT-registered seller carries a QR code: base64 of a TLV
//   (tag, length, UTF-8 value) list: 1 seller name, 2 VAT number, 3 timestamp, 4 total with VAT, 5 VAT amount.
//   Phase 2 (integration): UBL 2.1 XML, UUID, invoice counter (ICV), previous invoice hash (PIH) chain, and
//   clearance (standard/B2B, before sharing) or reporting (simplified/B2C, within 24h) through ZATCA's API.
//   Onboarding (the CSID certificate from the Fatoora portal) and XAdES signing are NOT done here yet:
//   the API adapter stays in Test mode and refuses Live until signing is built. Founder task: onboarding.
import crypto from "node:crypto";

// ---- phase 1 QR
export function tlv(fields) {
  const parts = [];
  fields.forEach((v, i) => {
    const b = Buffer.from(String(v ?? ""), "utf8");
    if (b.length > 255) throw new Error(`QR field ${i + 1} is too long`);
    parts.push(Buffer.from([i + 1, b.length]), b);
  });
  return Buffer.concat(parts);
}
export const qrBase64 = ({ seller, vat_number, timestamp, total, vat }) => tlv([seller, vat_number, timestamp, money(total), money(vat)]).toString("base64");
export function decodeTlv(b64) {
  const b = Buffer.from(b64, "base64"), out = {};
  for (let i = 0; i < b.length;) { const tag = b[i], len = b[i + 1]; out[tag] = b.subarray(i + 2, i + 2 + len).toString("utf8"); i += 2 + len; }
  return out;
}
const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

// ---- phase 2 structure
// The first invoice's "previous hash" is the base64 of the SHA-256 hex digest of "0" (ZATCA developer guide).
export const INITIAL_PIH = Buffer.from(crypto.createHash("sha256").update("0").digest("hex")).toString("base64");

// Invoice type: name attribute 0100000 = standard (B2B, buyer has a VAT number), 0200000 = simplified (B2C).
// Code: 388 tax invoice, 381 credit note, 383 debit note.
export const typeCode = (doc) => ({ name: doc.zatca_type === "standard" ? "0100000" : "0200000", code: doc.kind === "credit_note" ? "381" : "388" });

const x = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const party = (p, isSeller) => `
      <cac:Party>${p.cr_number ? `
        <cac:PartyIdentification><cbc:ID schemeID="CRN">${x(p.cr_number)}</cbc:ID></cac:PartyIdentification>` : ""}
        <cac:PostalAddress>
          <cbc:StreetName>${x(p.address?.street)}</cbc:StreetName>
          <cbc:BuildingNumber>${x(p.address?.building)}</cbc:BuildingNumber>
          <cbc:CitySubdivisionName>${x(p.address?.district)}</cbc:CitySubdivisionName>
          <cbc:CityName>${x(p.address?.city)}</cbc:CityName>
          <cbc:PostalZone>${x(p.address?.postal_code)}</cbc:PostalZone>
          <cac:Country><cbc:IdentificationCode>${x(p.address?.country || "SA")}</cbc:IdentificationCode></cac:Country>
        </cac:PostalAddress>${p.vat_number || isSeller ? `
        <cac:PartyTaxScheme>
          <cbc:CompanyID>${x(p.vat_number)}</cbc:CompanyID>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:PartyTaxScheme>` : ""}
        <cac:PartyLegalEntity><cbc:RegistrationName>${x(p.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
      </cac:Party>`;

// UBL 2.1 invoice/credit note in ZATCA's profile. `doc` is an issued billing document (see billing.js).
// Amounts are in the document currency; the tax total is repeated in SAR as ZATCA requires (TaxCurrencyCode).
export function ublXml(doc, { seller, buyer, uuid, icv, pih, qr = "" }) {
  const cur = doc.currency, t = doc.totals, rate = Math.round(doc.vat_rate * 100 * 100) / 100;
  const amt = (n) => `currencyID="${cur}">${money(n)}`;
  const issued = new Date(doc.issued_at);
  const date = doc.issue_date, time = issued.toISOString().slice(11, 19);
  const tt = typeCode(doc);
  const cat = rate > 0 ? "S" : "O"; // S = standard rate; O = outside the scope (seller not registered); verify with your accountant
  const lines = doc.lines.map((l, i) => {
    const net = l.net, vat = Math.round(net * doc.vat_rate * 100) / 100;
    return `
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">${l.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount ${amt(net)}</cbc:LineExtensionAmount>${l.discount ? `
    <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason><cbc:Amount ${amt(l.discount)}</cbc:Amount></cac:AllowanceCharge>` : ""}
    <cac:TaxTotal>
      <cbc:TaxAmount ${amt(vat)}</cbc:TaxAmount>
      <cbc:RoundingAmount ${amt(net + vat)}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${x(l.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>${cat}</cbc:ID><cbc:Percent>${rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount ${amt(l.unit_price)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><!-- XAdES signature goes here after onboarding (phase 2) --></ext:UBLExtensions>
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${x(doc.number)}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${date}</cbc:IssueDate>
  <cbc:IssueTime>${time}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${tt.name}">${tt.code}</cbc:InvoiceTypeCode>${doc.kind === "credit_note" ? `
  <cbc:Note>${x(doc.credit_reason)}</cbc:Note>` : ""}
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>${doc.kind === "credit_note" ? `
  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${x(doc.credit_of_number)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : ""}
  <cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${icv}</cbc:UUID></cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${pih}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  <cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID><cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature>
  <cac:AccountingSupplierParty>${party(seller, true)}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${party(buyer, false)}
  </cac:AccountingCustomerParty>
  <cac:Delivery><cbc:ActualDeliveryDate>${x(doc.supply_date || date)}</cbc:ActualDeliveryDate></cac:Delivery>
  <cac:PaymentMeans><cbc:PaymentMeansCode>${doc.kind === "credit_note" ? "30" : "42"}</cbc:PaymentMeansCode>${doc.kind === "credit_note" ? `<cbc:InstructionNote>${x(doc.credit_reason)}</cbc:InstructionNote>` : ""}</cac:PaymentMeans>${t.discount ? `
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>${x(doc.discount_reason || "discount")}</cbc:AllowanceChargeReason>
    <cbc:Amount ${amt(t.discount)}</cbc:Amount>
    <cac:TaxCategory><cbc:ID>${cat}</cbc:ID><cbc:Percent>${rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
  </cac:AllowanceCharge>` : ""}
  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${money(doc.totals_sar.vat)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:TaxTotal>
    <cbc:TaxAmount ${amt(t.vat)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount ${amt(t.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount ${amt(t.vat)}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>${cat}</cbc:ID><cbc:Percent>${rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount ${amt(t.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount ${amt(t.taxable)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount ${amt(t.total)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount ${amt(t.discount)}</cbc:AllowanceTotalAmount>
    <cbc:PrepaidAmount ${amt(0)}</cbc:PrepaidAmount>
    <cbc:PayableAmount ${amt(t.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</Invoice>
`;
}

// Invoice hash: SHA-256 (base64) of the XML without UBLExtensions, the Signature and the QR reference, as
// ZATCA specifies. ZATCA canonicalizes with C14N 1.1 first; our XML is generated in one fixed form, so the
// same input always gives the same hash. Before going Live, check hashes with the ZATCA SDK (docs).
export function hashInput(xml) {
  return xml
    .replace(/<\?xml[^>]*\?>\s*/, "")
    .replace(/\s*<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "")
    .replace(/\s*<cac:Signature>[\s\S]*?<\/cac:Signature>/, "")
    .replace(/\s*<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, "");
}
export const invoiceHash = (xml) => crypto.createHash("sha256").update(hashInput(xml), "utf8").digest("base64");

// ---- API adapter (clearance for standard, reporting for simplified). Test mode logs and never calls ZATCA.
export const ZATCA_HOSTS = { // verify against current docs (ZATCA developer portal)
  sandbox: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  simulation: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  production: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
};
export function zatcaConfig(env = process.env) {
  return { env: ZATCA_HOSTS[env.ZATCA_ENV] ? env.ZATCA_ENV : "sandbox", csid: env.ZATCA_CSID || "", secret: env.ZATCA_CSID_SECRET || "", signing_ready: false };
}
export function zatcaRequest(cfg, doc, { xml, hash, uuid }) {
  const clearance = doc.zatca_type === "standard";
  return {
    url: `${ZATCA_HOSTS[cfg.env]}/invoices/${clearance ? "clearance" : "reporting"}/single`, // verify against current docs
    method: "POST",
    headers: { "Accept-Version": "V2", "Accept-Language": "en", "Content-Type": "application/json", ...(clearance ? { "Clearance-Status": "1" } : {}),
      Authorization: "Basic " + Buffer.from(`${cfg.csid}:${cfg.secret}`).toString("base64") },
    body: JSON.stringify({ invoiceHash: hash, uuid, invoice: Buffer.from(xml, "utf8").toString("base64") }),
  };
}
export function createZatca({ cfg = zatcaConfig(), fetchImpl = (...a) => fetch(...a) } = {}) {
  return {
    cfg,
    async submit(doc, { mode, xml, hash, uuid }) {
      const req = zatcaRequest(cfg, doc, { xml, hash, uuid });
      const kind = doc.zatca_type === "standard" ? "clearance" : "reporting";
      if (mode !== "live") return { status: "test", kind, note: `Test mode: ${kind} not sent to ZATCA` };
      if (!cfg.csid || !cfg.secret) return { status: "blocked", kind, note: "No CSID: finish ZATCA onboarding first (ZATCA_CSID, ZATCA_CSID_SECRET)" };
      if (!cfg.signing_ready) return { status: "blocked", kind, note: "Invoice signing (XAdES with the CSID private key) isn't built yet: nothing sent" };
      const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
      const j = await res.json().catch(() => ({}));
      return { status: res.ok ? "accepted" : "rejected", kind, http: res.status, note: JSON.stringify(j.validationResults || j).slice(0, 500) };
    },
  };
}
