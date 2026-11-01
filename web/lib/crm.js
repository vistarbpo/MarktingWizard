// Store CRM: the database of Salla/Zid stores, lifecycle stages, segments, lead scoring,
// message templates and AI prompts for outreach, newsletters and onboarding.
// The rule matches the rest of the dashboard: AI writes and sends what it safely can;
// people handle live calls, pricing and anything the AI marks as needing a person.

// Lifecycle, like a B2B revenue team runs it: marketing → sales → onboarding → customer success.
export const STAGES = [
  { id: "new", name: "New", team: "Marketing", hint: "Imported, never contacted" },
  { id: "contacted", name: "Contacted", team: "Marketing", hint: "In an outreach sequence" },
  { id: "engaged", name: "Replied", team: "Sales", hint: "Replied or contacted us" },
  { id: "qualified", name: "Qualified", team: "Sales", hint: "Interested and a fit: deal created in Sales" },
  { id: "onboarding", name: "Onboarding", team: "Customer Success", hint: "Signed up, setting up" },
  { id: "active", name: "Active customer", team: "Customer Success", hint: "Ads live from DPA AD" },
  { id: "churned", name: "Churned", team: "Customer Success", hint: "Stopped using or paying" },
  { id: "not_now", name: "Not now", team: "Marketing", hint: "Said no or later; newsletter only" },
  { id: "do_not_contact", name: "Do not contact", team: "—", hint: "Unsubscribed, bounced or bad data" },
];
export const STAGE_IDS = STAGES.map((s) => s.id);
export const BOARD = ["new", "contacted", "engaged", "qualified", "onboarding", "active", "churned", "not_now"];

// Onboarding checklist for a new DPA AD customer (Customer Success tracks it per store).
export const ONBOARDING_STEPS = [
  { id: "app", name: "Installed the DPA AD app on Salla / Zid" },
  { id: "catalog", name: "Catalog imported" },
  { id: "brand", name: "Brand kit set (logo, colors, fonts)" },
  { id: "template", name: "First template picked and rendered" },
  { id: "catalog_ads", name: "Connected to Meta / Snap / TikTok catalog" },
  { id: "live", name: "First designed ads live" },
  { id: "roas", name: "First ROAS check (designed vs plain)" },
];

export const CAMPAIGN_TYPES = [
  { id: "outreach", name: "Outreach sequence", hint: "Multi-step email/WhatsApp to stores that don't know us yet. Stops when they reply." },
  { id: "newsletter", name: "Newsletter / broadcast", hint: "One message to a segment at a set time." },
  { id: "onboarding", name: "Onboarding flow", hint: "Starts automatically when a store moves to Onboarding." },
  { id: "nurture", name: "Nurture", hint: "Slow drip for 'Not now' stores: tips, case studies, offers." },
];
export const CHANNELS = ["email", "whatsapp"];
export const INTENTS = ["interested", "question", "not_now", "not_interested", "unsubscribe", "wrong_person", "out_of_office", "other"];

export const SALLA_CATEGORIES = ["Fashion & abayas", "Perfumes & oud", "Beauty & cosmetics", "Electronics & accessories", "Home & furniture",
  "Food & sweets", "Coffee & dates", "Kids & toys", "Gifts & flowers", "Health & supplements", "Sports", "Jewelry & watches", "Books & stationery", "Other"];

export const CATEGORY_AR = { "Fashion & abayas": "الأزياء والعبايات", "Perfumes & oud": "العطور والعود", "Beauty & cosmetics": "التجميل والعناية", "Electronics & accessories": "الإلكترونيات والإكسسوارات",
  "Home & furniture": "المنزل والأثاث", "Food & sweets": "الأغذية والحلويات", "Coffee & dates": "القهوة والتمور", "Kids & toys": "الأطفال والألعاب", "Gifts & flowers": "الهدايا والورد",
  "Health & supplements": "الصحة والمكملات", "Sports": "الرياضة", "Jewelry & watches": "المجوهرات والساعات", "Books & stationery": "الكتب والقرطاسية", Other: "التجارة الإلكترونية" };

// ---- CSV import -------------------------------------------------------------------------
export function splitCsv(text) {
  const src = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const first = src.slice(0, src.indexOf("\n") === -1 ? undefined : src.indexOf("\n"));
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"' && src[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cur.trim()); cur = ""; }
    else if (c === "\n") { row.push(cur.trim()); if (row.some((x) => x)) rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  row.push(cur.trim()); if (row.some((x) => x)) rows.push(row);
  return rows;
}

// Header names seen in Salla store lists, in English and Arabic. First match wins.
export const IMPORT_FIELDS = {
  store_name: [/^(store|shop)( name)?$/, /store.?name/, /^name$/, /اسم المتجر/, /المتجر/, /^الاسم$/],
  domain: [/domain/, /^url$/, /website/, /store.?url/, /link/, /رابط/, /الموقع/, /الدومين/],
  email: [/e-?mail/, /البريد/, /ايميل|إيميل/],
  phone: [/whats?app/, /phone/, /mobile/, /^tel/, /جوال/, /واتس/, /هاتف/, /رقم/],
  category: [/categor/, /industry/, /niche/, /^type$/, /التصنيف/, /الفئة/, /النشاط/, /القسم/],
  city: [/city/, /المدينة/, /^location$/, /region/, /المنطقة/],
  products: [/products?( count)?$/, /sku/, /items/, /عدد المنتجات/, /المنتجات/],
  owner_name: [/owner/, /contact( name)?$/, /^first.?name/, /المالك/, /اسم التاجر/, /التاجر/],
  instagram: [/instagram/, /انستقرام|انستجرام/],
  platform: [/platform/, /المنصة/],
  rating: [/rating/, /التقييم/],
  wa_opt_in: [/consent/, /opt.?in/, /موافقة/],
};

export function mapHeader(header) {
  const h = header.map((x) => String(x || "").toLowerCase().trim());
  const map = {}, used = new Set();
  for (const [field, pats] of Object.entries(IMPORT_FIELDS)) {
    for (const p of pats) {
      const i = h.findIndex((x, j) => !used.has(j) && p.test(x));
      if (i >= 0) { map[field] = i; used.add(i); break; }
    }
  }
  return map;
}

// Saudi numbers to international digits: 05XXXXXXXX / 5XXXXXXXX / +9665… → 9665XXXXXXXX.
export function normPhone(v) {
  let d = String(v || "").replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = "966" + d.slice(1);
  else if (/^5\d{8}$/.test(d)) d = "966" + d;
  return d.length >= 9 && d.length <= 15 ? d : "";
}
export function normDomain(v) {
  const s = String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  return s.split(/[/?#\s]/)[0].slice(0, 120);
}
export const normEmail = (v) => { const e = String(v || "").trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) ? e.slice(0, 200) : ""; };
const truthy = (v) => /^(1|y|yes|true|نعم|موافق)$/i.test(String(v || "").trim());

export function matchCategory(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s) return "Other";
  const rules = [
    ["Fashion & abayas", /fashion|abaya|cloth|wear|dress|عباي|ازياء|أزياء|ملابس|فساتين|شماغ/],
    ["Perfumes & oud", /perfume|oud|fragrance|incense|عطر|عطور|عود|بخور|دهن/],
    ["Beauty & cosmetics", /beauty|cosmetic|makeup|skin|hair|تجميل|مكياج|بشرة|شعر/],
    ["Electronics & accessories", /electr|phone|mobile|gadget|computer|gaming|الكترون|إلكترون|جوالات|اكسسوارات الجوال|العاب الفيديو/],
    ["Home & furniture", /home|furnit|decor|kitchen|منزل|اثاث|أثاث|ديكور|مطبخ|مفروشات/],
    ["Coffee & dates", /coffee|dates|قهوة|تمور|تمر|بن/],
    ["Food & sweets", /food|sweet|chocolate|bakery|حلويات|اغذية|أغذية|شوكولا|مخبوزات|طعام/],
    ["Kids & toys", /kid|baby|toy|child|اطفال|أطفال|العاب|ألعاب|مواليد/],
    ["Gifts & flowers", /gift|flower|هدايا|ورد|زهور|تغليف/],
    ["Health & supplements", /health|supplement|vitamin|pharma|صحة|مكملات|فيتامين|صيدلي/],
    ["Sports", /sport|fitness|gym|رياض/],
    ["Jewelry & watches", /jewel|watch|gold|silver|مجوهرات|ساعات|ذهب|فضة|اكسسوارات/],
    ["Books & stationery", /book|station|كتب|قرطاسية|مكتب/],
  ];
  return (rules.find(([, re]) => re.test(s)) || [SALLA_CATEGORIES.includes(raw) ? raw : "Other"])[0];
}

// Turns pasted/uploaded rows into clean contacts. Returns rows + problems for the preview.
export function parseStores(text, { platform = "Salla", source = "import" } = {}) {
  const rows = splitCsv(text);
  if (rows.length < 2) return { error: "Upload a CSV with a header row and at least one store." };
  const map = mapHeader(rows[0]);
  if (map.store_name == null && map.domain == null) return { error: "Couldn't find a store name or store link column. Name the columns e.g. store_name, domain, email, phone, category, city, products." };
  const get = (r, f) => (map[f] == null ? "" : r[map[f]] || "");
  const out = []; let noContact = 0;
  for (const r of rows.slice(1)) {
    const domain = normDomain(get(r, "domain"));
    const name = String(get(r, "store_name") || domain).trim().slice(0, 160);
    if (!name) continue;
    const c = {
      store_name: name, domain, email: normEmail(get(r, "email")), phone: normPhone(get(r, "phone")),
      category_raw: String(get(r, "category")).slice(0, 80), category: matchCategory(get(r, "category")),
      city: String(get(r, "city")).trim().slice(0, 60), products: Math.max(0, parseInt(String(get(r, "products")).replace(/\D/g, ""), 10) || 0),
      owner_name: String(get(r, "owner_name")).trim().slice(0, 100), instagram: String(get(r, "instagram")).trim().slice(0, 120),
      platform: String(get(r, "platform")).trim() || platform, rating: parseFloat(get(r, "rating")) || null,
      wa_opt_in: truthy(get(r, "wa_opt_in")), source,
    };
    if (!c.email && !c.phone) noContact++;
    out.push(c);
  }
  return { rows: out, columns: Object.fromEntries(Object.entries(map).map(([k, i]) => [k, rows[0][i]])), no_contact: noContact, total: out.length };
}

// ---- scoring: who to contact first ---------------------------------------------------------
// Intent signals: proxies for "ready to buy now". Tag stores with these (e.g. after checking the
// Meta Ad Library or Snap ads) and they rise to the top of every list and segment.
export const INTENT_TAGS = { "running-ads": 15, "hiring-marketer": 10, "new-collection": 8, "seasonal": 5, "visited-site": 12, "inbound": 20, "referral": 15 };

// Masterclass benchmarks for cold outbound (Arjun): ~5% of contacted stores reply, ~10% of replies become a
// meeting, and a healthy sales process closes 20%+ of opportunities.
export const OUTBOUND_BENCH = { reply: 0.05, meeting: 0.1, close: 0.2 };

export function scoreContact(c) {
  let s = 0;
  const p = c.products || 0;
  s += p >= 1000 ? 35 : p >= 300 ? 28 : p >= 100 ? 20 : p >= 30 ? 10 : p > 0 ? 4 : 6;  // catalog size = DPA AD value
  if (c.email) s += 10;
  if (c.phone) s += 8;
  if (c.wa_opt_in) s += 7;
  if (c.instagram) s += 5;                                     // already marketing on social
  if (["Fashion & abayas", "Perfumes & oud", "Beauty & cosmetics", "Electronics & accessories", "Jewelry & watches", "Home & furniture"].includes(c.category)) s += 15; // ad-heavy categories
  if (c.rating >= 4.5) s += 5;
  if (c.last_reply_at) s += 15;
  if (c.stage === "qualified" || c.stage === "onboarding") s += 10;
  for (const t of c.tags || []) s += INTENT_TAGS[t] || 0;
  return Math.min(100, s);
}

// ---- segments ------------------------------------------------------------------------------
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x !== "" && x != null) : v ? [v] : []);
export function cleanFilter(f = {}) {
  return {
    q: String(f.q || "").trim().slice(0, 100), category: arr(f.category), city: arr(f.city), stage: arr(f.stage), platform: arr(f.platform), tags: arr(f.tags),
    owner_id: f.owner_id ? String(f.owner_id) : "", min_products: Number(f.min_products) || 0, max_products: Number(f.max_products) || 0,
    min_score: Number(f.min_score) || 0, has_email: !!f.has_email, has_whatsapp: !!f.has_whatsapp,
    quiet_days: Number(f.quiet_days) || 0, // not contacted in N days
  };
}
export function matches(c, f, now = Date.now()) {
  if (f.q) { const q = f.q.toLowerCase(); if (!`${c.store_name} ${c.domain} ${c.email} ${c.phone} ${c.owner_name}`.toLowerCase().includes(q)) return false; }
  if (f.category.length && !f.category.includes(c.category)) return false;
  if (f.city.length && !f.city.includes(c.city)) return false;
  if (f.stage.length && !f.stage.includes(c.stage)) return false;
  if (f.platform.length && !f.platform.includes(c.platform)) return false;
  if (f.tags.length && !f.tags.some((t) => (c.tags || []).includes(t))) return false;
  if (f.owner_id && (f.owner_id === "none" ? c.owner_id : c.owner_id !== f.owner_id)) return false;
  if (f.min_products && (c.products || 0) < f.min_products) return false;
  if (f.max_products && (c.products || 0) > f.max_products) return false;
  if (f.min_score && (c.score || 0) < f.min_score) return false;
  if (f.has_email && (!c.email || c.email_opt_out || c.bounced)) return false;
  if (f.has_whatsapp && !c.phone) return false;
  if (f.quiet_days && c.last_contacted_at && now - Date.parse(c.last_contacted_at) < f.quiet_days * 864e5) return false;
  return true;
}

// ---- templates -----------------------------------------------------------------------------
// {{store_name}} {{owner_name}} {{category}} {{city}} {{products}} {{domain}} {{sender_name}} {{company}}
export function renderTemplate(tpl, c, extra = {}) {
  const vars = { store_name: c.store_name, owner_name: c.owner_name || (/[؀-ۿ]/.test(tpl) ? "" : "there"), category: c.category, category_ar: CATEGORY_AR[c.category] || c.category, city: c.city || "", products: c.products || "", domain: c.domain || "", ...extra };
  return String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? "")).replace(/ +([،,])/g, "$1").replace(/[ \t]+\n/g, "\n").replace(/  +/g, " ");
}

export const STARTER_CAMPAIGNS = [
  {
    name: "Salla stores · cold outreach (AR/EN)", type: "outreach", stop_on_reply: true,
    filter: { stage: ["new"], has_email: true, min_products: 30 },
    steps: [
      { channel: "email", delay_days: 0, subject: "إعلانات مصممة لكل منتج في {{store_name}}",
        body: "السلام عليكم {{owner_name}}،\n\nشفت متجر {{store_name}} على سلة، وعندكم {{products}} منتج. أغلب إعلانات الكتالوج في سناب وميتا وتيك توك تطلع صورة منتج عادية على خلفية بيضاء.\n\nDPA AD يحوّل كتالوجكم تلقائياً إلى إعلانات صور وفيديو مصممة بالعربي، مع السعر والخصم محدّثين دائماً.\n\nأقدر أرسل لكم ٣ نماذج مجانية من منتجاتكم أنتم؟ ردّوا بـ \"نعم\" فقط.\n\nتحياتي،\n{{sender_name}}" },
      { channel: "email", delay_days: 3, subject: "نماذج {{store_name}}",
        body: "أهلاً {{owner_name}}،\n\nأتابع رسالتي السابقة. متاجر {{category_ar}} اللي تستخدم إعلانات مصممة بدل الصورة العادية تقدر تختبر أكثر من تصميم لكل منتج وتعرف وش يبيع.\n\nتبون أجهّز لكم ٣ نماذج مجانية؟ ما تحتاجون تسوون شي، نأخذ المنتجات من متجركم مباشرة.\n\n{{sender_name}}" },
      { channel: "whatsapp", delay_days: 4, subject: "", wa_template: "dpa_intro_ar",
        body: "السلام عليكم، معك {{sender_name}} من DPA AD. جهزنا فكرة إعلانات مصممة لمنتجات {{store_name}} لسناب وتيك توك. تحب أرسل لك ٣ نماذج مجانية؟" },
      { channel: "email", delay_days: 6, subject: "آخر رسالة مني",
        body: "{{owner_name}}، ما أبي أزعجكم. إذا التوقيت مو مناسب الحين، ردّوا بـ \"لاحقاً\" وأرجع لكم بعد شهرين.\n\nوإذا تبون تشوفون كيف تطلع منتجاتكم كإعلانات مصممة، الرابط: https://dpa.ad\n\n{{sender_name}}" },
    ],
  },
  {
    name: "Monthly newsletter · White Friday tips", type: "newsletter",
    filter: { stage: ["contacted", "engaged", "qualified", "onboarding", "active", "not_now"], has_email: true },
    steps: [{ channel: "email", delay_days: 0, subject: "الجمعة البيضاء قربت: ٣ أفكار لإعلانات {{store_name}}",
      body: "أهلاً {{owner_name}}،\n\nباقي أقل من شهر على الجمعة البيضاء، وهي أزحم فترة إعلانات في السنة. هذه ٣ أفكار سريعة لمتاجر {{category_ar}}:\n\n١. خلّ السعر والخصم داخل التصميم\nالصورة العادية ما توضح العرض. إعلان فيه السعر قبل وبعد ونسبة الخصم يوصل الرسالة من أول نظرة، خصوصاً في سناب وتيك توك.\n\n٢. جهّز أكثر من تصميم لكل منتج\nلا تعتمد على إعلان واحد. جرّب ٢-٣ تصاميم مختلفة لنفس المنتج من الحين، وخلّ الميزانية الأكبر في الجمعة البيضاء للتصميم اللي يبيع أكثر.\n\n٣. حدّث الأسعار تلقائياً\nأكبر مشكلة في مواسم الخصومات إعلانات بأسعار قديمة. اربط الإعلانات بالكتالوج عشان أي تغيير في السعر يتحدّث في الإعلان مباشرة.\n\nومن الحين ابدأ تفكّر في رمضان: يبدأ تقريباً في فبراير، والمتاجر اللي تجهّز تصاميمها بدري تختبر أكثر قبل الموسم.\n\nتبون نجهّز لكم ٣ نماذج مجانية بتصاميم الجمعة البيضاء من منتجات {{store_name}}؟ ردّوا على هذا الإيميل بـ \"نعم\".\n\n{{sender_name}}\nفريق DPA AD" }],
  },
  {
    name: "Ramadan newsletter · get ready early", type: "newsletter", start_at: "2027-01-11T07:00:00.000Z",
    filter: { stage: ["contacted", "engaged", "qualified", "onboarding", "active", "not_now"], has_email: true },
    steps: [{ channel: "email", delay_days: 0, subject: "رمضان قرّب: جهّز إعلانات {{store_name}} من الحين",
      body: "أهلاً {{owner_name}}،\n\nرمضان يبدأ تقريباً ٨ فبراير (حسب رؤية الهلال)، والمتاجر اللي تجهّز إعلاناتها الحين تدخل الموسم وهي عارفة وش يبيع. هذه ٤ أفكار لمتاجر {{category_ar}}:\n\n١. ابدأ التصاميم الرمضانية من يناير\nجرّب ٢-٣ تصاميم رمضانية لكل منتج قبل الموسم بأسبوعين، وخلّ الميزانية في رمضان للتصميم اللي أثبت نفسه بدل ما تجرّب وقت الذروة.\n\n٢. خلّ النص عربي وواضح داخل الإعلان\nاسم المنتج والسعر والعرض بخط عربي واضح على الصورة نفسها. في سناب وتيك توك الناس تقرر في ثانية.\n\n٣. رتّب ميزانيتك على أوقات رمضان\nالتصفح يزيد بعد الإفطار وإلى السحور. وزّع الميزانية على هذي الساعات، وجهّز إعلانات خاصة للعشر الأواخر وهدايا العيد.\n\n٤. جهّز إعلانات العيد قبل نهاية رمضان\nعروض العيد وهداياه تبدأ قبل العيد بأيام. خلّ تصاميمها جاهزة من منتصف الشهر عشان ما تتأخر.\n\nوتذكير: يوم التأسيس (٢٢ فبراير) يجي هالسنة داخل رمضان، فكّر في تصميم يجمع المناسبتين.\n\nتبون نجهّز لكم ٣ نماذج مجانية بتصاميم رمضانية من منتجات {{store_name}}؟ ردّوا على هذا الإيميل بـ \"نعم\".\n\nرمضان كريم مقدماً،\n{{sender_name}}\nفريق DPA AD" }],
  },
  {
    name: "Onboarding · first ads live in 7 days", type: "onboarding", trigger: "stage:onboarding",
    filter: {},
    steps: [
      { channel: "email", delay_days: 0, subject: "أهلاً بكم في DPA AD 👋 خطوتكم الأولى", body: "أهلاً {{owner_name}}،\n\nسعداء بانضمام {{store_name}}. أول خطوة: ثبّتوا تطبيق DPA AD من متجر تطبيقات سلة، وبنسحب الكتالوج تلقائياً.\n\nأي سؤال؟ ردّوا على هذا الإيميل.\n\n{{sender_name}}" },
      { channel: "whatsapp", delay_days: 1, subject: "", wa_template: "dpa_onboarding_ar", body: "أهلاً {{owner_name}}، هنا {{sender_name}} من DPA AD. هل تم استيراد منتجات {{store_name}}؟ إذا احتجتم مساعدة في اختيار أول قالب أنا موجود." },
      { channel: "email", delay_days: 2, subject: "اختاروا أول قالب لإعلاناتكم", body: "{{owner_name}}، جهّزنا قوالب مناسبة لمتاجر {{category_ar}}. اختاروا واحد واضغطوا \"توليد\" وبتطلع إعلانات لكل المنتجات.\n\n{{sender_name}}" },
      { channel: "email", delay_days: 2, subject: "اربطوا الإعلانات بسناب وميتا", body: "الخطوة الأخيرة: اربطوا كتالوج DPA AD بحسابكم الإعلاني في سناب/ميتا/تيك توك. الدليل خطوة بخطوة: https://dpa.ad\n\n{{sender_name}}" },
      { channel: "email", delay_days: 7, subject: "كيف أداء الإعلانات المصممة؟", body: "{{owner_name}}، مر أسبوع. نقدر نقارن أداء الإعلانات المصممة مع الصور العادية ونرسل لكم تقرير ROAS. تبون؟\n\n{{sender_name}}" },
    ],
  },
];

// ---- AI prompts ----------------------------------------------------------------------------
export function sequencePrompt(ws, { type, category, goal, channels, steps, language }) {
  return `<company>\n${ws.brief.company_name}: ${ws.brief.one_liner}\nPricing: ${ws.brief.pricing}\nVoice: ${ws.brief.brand_voice}\n</company>
<task title="${type} sequence for ${category || "all categories"}">
Write a ${steps}-step ${type} sequence for Saudi online stores${category ? ` in the "${category}" category` : ""} on Salla/Zid.
Goal: ${goal || "get a reply asking for free sample ads from their own catalog"}.
Channels allowed: ${channels.join(", ")}. Language: ${language === "en" ? "English" : "Saudi Arabic (natural, short, respectful), no English except the brand name"}.
Rules: short (email bodies under 110 words, WhatsApp under 50 words), one clear yes/no ask per message, no fake numbers or results, no invented customers, each step adds a new angle (pain, idea for their category, social proof only if real, breakup). Use the placeholders {{store_name}}, {{owner_name}}, {{category_ar}} (Arabic category name; {{category}} is English), {{products}}, {{sender_name}} where natural. Don't write an unsubscribe line; it is added automatically.
Return ONLY JSON, no prose: {"steps":[{"channel":"email|whatsapp","delay_days":0,"subject":"(email only)","body":"..."}]}
</task>`;
}
export function parseSequence(text, allowed = CHANNELS) {
  const m = /\{[\s\S]*\}/.exec(String(text || ""));
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const steps = (j.steps || []).map((s) => ({ channel: allowed.includes(s.channel) ? s.channel : allowed[0], delay_days: Math.max(0, Math.min(60, Number(s.delay_days) || 0)), subject: String(s.subject || "").slice(0, 200), body: String(s.body || "").slice(0, 4000) })).filter((s) => s.body);
    return steps.length ? steps : null;
  } catch { return null; }
}

export function replyTriagePrompt(ws, c, history, inbound) {
  return `<company>\n${ws.brief.company_name}: ${ws.brief.one_liner}\nPricing: ${ws.brief.pricing}\n</company>
<store name="${c.store_name}" category="${c.category}" city="${c.city}" products="${c.products}" stage="${c.stage}" />
<conversation oldest_first>\n${history.map((m) => `[${m.direction === "in" ? "STORE" : "US"} · ${m.channel}] ${m.subject ? m.subject + ": " : ""}${m.body.slice(0, 600)}`).join("\n")}\n</conversation>
<new_message channel="${inbound.channel}">\n${inbound.body.slice(0, 3000)}\n</new_message>
Classify the store's new message and draft our reply in the same language and channel. Intents: ${INTENTS.join(", ")}.
needs_person = true if they ask about price discounts, contracts, a call/meeting, a complaint, or anything you are unsure about.
First line exactly: META {"intent":"...","needs_person":true|false,"summary":"one short line in English"}
Then the reply text only (under 90 words, friendly, one next step). Never promise prices or results not in the company info.`;
}
export function parseTriage(text) {
  const raw = String(text || "");
  const m = /^\s*META\s*(\{.*\})\s*$/m.exec(raw.split("\n").slice(0, 3).join("\n"));
  let meta = null;
  if (m) { try { meta = JSON.parse(m[1]); } catch { meta = null; } }
  const reply = m ? raw.slice(raw.indexOf(m[0]) + m[0].length).trim() : raw.trim();
  return { intent: INTENTS.includes(meta?.intent) ? meta.intent : guessIntent(raw), needs_person: meta ? meta.needs_person !== false : true, summary: String(meta?.summary || "").slice(0, 200), reply, checked: !!meta };
}
// Rule-based backup so unsubscribe always works, even without AI.
export function guessIntent(t) {
  const s = String(t || "").toLowerCase();
  if (/unsubscribe|stop|remove me|إلغاء الاشتراك|الغاء الاشتراك|لا ترسل|توقف|وقف/.test(s)) return "unsubscribe";
  if (/out of office|خارج المكتب|auto.?reply/.test(s)) return "out_of_office";
  if (/not interested|no thanks|غير مهتم|ما ابي|ما نبي|لا شكرا/.test(s)) return "not_interested";
  if (/later|next month|لاحقا|لاحقاً|بعدين|الشهر الجاي/.test(s)) return "not_now";
  if (/^\s*(yes|ok|sure|نعم|ايه|إيه|اوكي|تمام|ابي|أبي|ياليت|موافق)/.test(s) || /interested|مهتم|ارسل|أرسل/.test(s)) return "interested";
  if (/\?|؟|كم|how|price|سعر/.test(s)) return "question";
  return "other";
}

// ---- time: send only in Saudi business hours ----------------------------------------------------
export const RIYADH_OFFSET = 3; // UTC+3, no daylight saving
export function inWindow(date, { from = 9, to = 21, skip_friday = true } = {}) {
  const t = new Date(date.getTime() + RIYADH_OFFSET * 3600e3);
  const h = t.getUTCHours();
  if (skip_friday && t.getUTCDay() === 5) return false;
  return h >= from && h < to;
}
export function nextWindowStart(date, win = {}) {
  let t = new Date(date.getTime());
  for (let i = 0; i < 24 * 8 && !inWindow(t, win); i++) t = new Date(Math.floor(t.getTime() / 3600e3) * 3600e3 + 3600e3);
  return t;
}
export const riyadhDay = (d = new Date()) => new Date(d.getTime() + RIYADH_OFFSET * 3600e3).toISOString().slice(0, 10);
