import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ArrowLeft, Check, Search, Globe } from "lucide-react";
import { storeUtmParams, getStoredUtmParams } from "@/utils/utm";
import { trackEvent, EVENTS } from "@/utils/tracking";

const TOTAL_STEPS = 5;
const API_BASE = "https://pageaudit-engine.onrender.com";
const FB_PHOTO = (username) => `${API_BASE}/api/fb-photo/${encodeURIComponent(username)}`;

const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim() || "");
};

const extractDomain = (input) => {
  if (!input) return "";
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/https?:\/\//i, '').replace(/www\./i, '').split('/')[0].split('@').pop();
  const parts = domain.split('.');
  if (parts.length >= 2) return parts[parts.length - 2];
  return domain;
};

function StepProgress({ step }) {
  return (
    <div className="w-full mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-400">Step {step} of {TOTAL_STEPS}</span>
        <span className="text-xs font-medium text-gray-400">{Math.round((step / TOTAL_STEPS) * 100)}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1">
        <div className="bg-[#1877F2] h-1 rounded-full transition-all duration-500" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
      </div>
    </div>
  );
}

function MultiCard({ selected, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left px-4 py-4 rounded-2xl border-2 transition-all duration-150 flex items-center gap-3 ${selected ? "border-[#1877F2] bg-blue-50 shadow-sm" : "border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm"}`}>
      <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${selected ? "border-[#1877F2] bg-[#1877F2]" : "border-gray-300 bg-white"}`}>
        {selected && <Check className="w-3 h-3 text-white" />}
      </span>
      <span className={`text-sm font-medium ${selected ? "text-[#1877F2]" : "text-gray-700"}`}>{children}</span>
    </button>
  );
}

function generateVariations(name, email = "", website = "") {
  const raw = name.trim();
  const cleaned = raw.replace(/\s+/g, '');
  const lower = cleaned.toLowerCase();
  const title = raw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  const withDots = raw.replace(/\s+/g, '.');
  const withDashes = raw.replace(/\s+/g, '-');
  const withUnder = raw.replace(/\s+/g, '_');
  const lowerDots = raw.toLowerCase().replace(/\s+/g, '.');
  const lowerDashes = raw.toLowerCase().replace(/\s+/g, '-');
  const lowerUnder = raw.toLowerCase().replace(/\s+/g, '_');
  const withThe = `the${lower}`;
  const withThe2 = `The${title}`;
  const withOfficial = `${lower}official`;
  const withOfficial2 = `${title}Official`;
  const withPage = `${lower}page`;
  const withBiz = `${lower}biz`;
  const withHQ = `${lower}hq`;
  const withReal = `real${lower}`;
  const withGet = `get${lower}`;
  const withMy = `my${lower}`;
  const withPro = `${lower}pro`;
  const withUS = `${lower}us`;
  const withCo = `${lower}co`;
  const withInc = `${lower}inc`;

  // Smart domain matching from email and website
  const emailDomain = extractDomain(email);
  const websiteDomain = extractDomain(website);

  const smartVariations = [];
  if (emailDomain && emailDomain !== lower) {
    smartVariations.push(emailDomain);
    smartVariations.push(`the${emailDomain}`);
  }
  if (websiteDomain && websiteDomain !== lower) {
    smartVariations.push(websiteDomain);
    smartVariations.push(`the${websiteDomain}`);
  }

  const variations = [
    // Smart matches first — highest probability
    ...smartVariations,
    cleaned,
    lower,
    title,
    withDots,
    withDashes,
    withUnder,
    lowerDots,
    lowerDashes,
    lowerUnder,
    withThe,
    withThe2,
    withOfficial,
    withOfficial2,
    withPage,
    withBiz,
    withHQ,
    withReal,
    withGet,
    withMy,
    withPro,
    withUS,
    withCo,
    withInc,
  ].filter(Boolean);

  return [...new Set(variations)].slice(0, 20);
}

function FacebookPageLookup({ value, onChange, email, website }) {
  const [pageName, setPageName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [imgSrc, setImgSrc] = useState("");
  const [imgError, setImgError] = useState(false);
  const [searching, setSearching] = useState(false);
  const [varIndex, setVarIndex] = useState(0);
  const [showVariations, setShowVariations] = useState(false);
  const [confirmedName, setConfirmedName] = useState("");
  const [pasteUrl, setPasteUrl] = useState("");
  const [noMoreVariations, setNoMoreVariations] = useState(false);
  const [allVariations, setAllVariations] = useState([]);
  const [showHelp, setShowHelp] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);

  const handleSearch = () => {
    if (!pageName.trim()) return;
    setSearching(true);
    setImgError(false);
    setShowVariations(false);
    setNoMoreVariations(false);
    setVarIndex(0);

    const vars = generateVariations(pageName, email, website);
    const cleaned = pageName.trim().replace(/\s+/g, '');
    const url = `https://www.facebook.com/${cleaned}`;

    setAllVariations(vars);
    setPreviewUrl(url);
    setImgSrc(FB_PHOTO(cleaned));
    setConfirmed(false);
    onChange("");
    setSearching(false);
  };

  const handleConfirm = () => {
    setConfirmed(true);
    setConfirmedName(showVariations ? allVariations[varIndex] : pageName.trim().replace(/\s+/g, ''));
    onChange(previewUrl);
    setShowVariations(false);
  };

  const handleNotRight = () => {
    const vars = generateVariations(pageName, email, website);
    setAllVariations(vars);
    setShowVariations(true);
    setVarIndex(0);
    setImgError(false);
    onChange("");
    const v = vars[0];
    setPreviewUrl(`https://www.facebook.com/${v}`);
    setImgSrc(FB_PHOTO(v));
  };

  const handleNextVariation = () => {
    const next = varIndex + 1;
    if (next >= allVariations.length) {
      setNoMoreVariations(true);
      setPreviewUrl("");
      setImgSrc("");
    } else {
      setVarIndex(next);
      setImgError(false);
      const v = allVariations[next];
      setPreviewUrl(`https://www.facebook.com/${v}`);
      setImgSrc(FB_PHOTO(v));
    }
  };

  const handleStartOver = () => {
    setConfirmed(false);
    setPreviewUrl("");
    setImgSrc("");
    setImgError(false);
    setPageName("");
    onChange("");
    setShowVariations(false);
    setAllVariations([]);
    setConfirmedName("");
    setPasteUrl("");
    setNoMoreVariations(false);
    setVarIndex(0);
    setShowHelp(false);
    setShowUpload(false);
  };

  const handlePasteUrl = (e) => {
    const val = e.target.value;
    setPasteUrl(val);
    if (val.includes('facebook.com')) {
      onChange(val);
      setPreviewUrl(val);
      const name = val.replace(/https?:\/\/(www\.)?facebook\.com\//i, '').replace(/\/$/, '').split('?')[0];
      setConfirmedName(name);
      setImgSrc(FB_PHOTO(name));
      setConfirmed(true);
    }
  };

  const handleScreenshot = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadLoading(true);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target.result.split(',')[1];
        const mediaType = file.type;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mediaType, data: base64 }
                },
                {
                  type: 'text',
                  text: 'Look at this screenshot of a Facebook page. Extract ONLY the Facebook page URL or username. Return ONLY the URL like "https://www.facebook.com/pagename" or just the username "pagename". Nothing else.'
                }
              ]
            }]
          })
        });

        const data = await response.json();
        const extracted = data?.content?.[0]?.text?.trim();

        if (extracted) {
          let fbUrl = extracted;
          let fbName = extracted;

          if (!extracted.includes('facebook.com')) {
            fbUrl = `https://www.facebook.com/${extracted}`;
            fbName = extracted;
          } else {
            fbName = extracted.replace(/https?:\/\/(www\.)?facebook\.com\//i, '').replace(/\/$/, '').split('?')[0];
          }

          setPreviewUrl(fbUrl);
          setImgSrc(FB_PHOTO(fbName));
          setConfirmedName(fbName);
          setPageName(fbName);
          setImgError(false);
          onChange("");
          setShowUpload(false);
          setNoMoreVariations(false);
          setShowVariations(false);
        }
        setUploadLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Screenshot analysis failed:', err);
      setUploadLoading(false);
    }
  };

  const handleGoogleSearch = () => {
    const query = encodeURIComponent(`site:facebook.com "${pageName || ""}" Facebook page`);
    window.open(`https://www.google.com/search?q=${query}`, '_blank');
  };

  const currentVariationName = showVariations ? allVariations[varIndex] : pageName.trim().replace(/\s+/g, '');

  return (
    <div className="space-y-4">
      {!confirmed ? (
        <>
          {/* LEVEL 1 — SEARCH BOX */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-1.5">
              Your Facebook Page Name <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. Righteous Network or AllredHeating"
                value={pageName}
                onChange={(e) => {
                  setPageName(e.target.value);
                  setPreviewUrl("");
                  setConfirmed(false);
                  setImgSrc("");
                  setShowVariations(false);
                  setNoMoreVariations(false);
                  setVarIndex(0);
                  onChange("");
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 border-2 border-gray-100 rounded-2xl px-4 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1877F2] transition-all"
              />
              <button type="button" onClick={handleSearch}
                disabled={!pageName.trim() || searching}
                className="inline-flex items-center gap-2 bg-[#1877F2] text-white px-5 py-3.5 text-sm font-bold rounded-2xl hover:bg-[#1457C0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
                {searching
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Search className="w-4 h-4" />}
                Find
              </button>
            </div>
            {(email || website) && (
              <p className="text-xs text-green-600 mt-2 font-medium">
                ✓ Using your {website ? 'website' : 'email'} domain to find better matches
              </p>
            )}
          </div>

          {/* PAGE PREVIEW — ONE AT A TIME */}
          {previewUrl && !noMoreVariations && (
            <div className="bg-blue-50 border-2 border-[#1877F2] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-bold text-[#1877F2] uppercase tracking-wide">
                  Is this your page?
                </p>
                {showVariations && (
                  <span className="text-xs text-gray-400 bg-white px-2 py-1 rounded-full border border-gray-200">
                    {varIndex + 1} of {allVariations.length}
                  </span>
                )}
              </div>

              <div className="bg-white rounded-xl p-4 mb-4 flex items-center gap-4 border border-gray-100 shadow-sm">
                {!imgError ? (
                  <img
                    src={imgSrc}
                    alt={currentVariationName}
                    onError={() => setImgError(true)}
                    className="w-16 h-16 rounded-full object-cover border-2 border-gray-100 shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-[#1877F2] flex items-center justify-center shrink-0">
                    <span className="text-white font-bold text-2xl">f</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-base truncate">{currentVariationName}</p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{previewUrl}</p>
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#1877F2] hover:underline font-semibold mt-1">
                    Open on Facebook ↗
                  </a>
                </div>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={handleConfirm}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-[#1877F2] text-white px-4 py-3 text-sm font-bold rounded-xl hover:bg-[#1457C0] transition-colors">
                  <Check className="w-4 h-4" /> Yes, that's my page!
                </button>
                <button type="button"
                  onClick={showVariations ? handleNextVariation : handleNotRight}
                  className="flex-1 border-2 border-gray-200 text-gray-600 px-4 py-3 text-sm font-semibold rounded-xl hover:border-gray-400 transition-colors">
                  {showVariations ? `Next → (${allVariations.length - varIndex - 1} left)` : "Not right, try again"}
                </button>
              </div>
            </div>
          )}

          {/* NO MORE VARIATIONS — show all fallback options */}
          {noMoreVariations && (
            <div className="space-y-3">
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4 text-center">
                <p className="text-sm font-bold text-yellow-800 mb-1">😕 Couldn't find your page automatically</p>
                <p className="text-xs text-yellow-700">We tried {allVariations.length} variations! Try one of the options below.</p>
              </div>

              {/* LEVEL 2 — HOW TO FIND YOUR URL */}
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <button type="button" onClick={() => setShowHelp(!showHelp)}
                  className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                  <span>📖 How to find your Facebook URL</span>
                  <span>{showHelp ? '▲' : '▼'}</span>
                </button>
                {showHelp && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
                    {[
                      { step: "1", icon: "📱", title: "Open Facebook", desc: "Go to facebook.com or open the Facebook app" },
                      { step: "2", icon: "🔍", title: "Find your page", desc: "Click on your business page name" },
                      { step: "3", icon: "🔗", title: "Copy the URL", desc: "Look at the address bar — copy everything after facebook.com/" },
                      { step: "4", icon: "📋", title: "Paste it below", desc: "Paste the URL in the box below and we'll confirm it's right" },
                    ].map(({ step, icon, title, desc }) => (
                      <div key={step} className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-[#1877F2] flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-white text-xs font-bold">{step}</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{icon} {title}</p>
                          <p className="text-xs text-gray-500">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* LEVEL 3 — SCREENSHOT UPLOAD */}
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <button type="button" onClick={() => setShowUpload(!showUpload)}
                  className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                  <span>📸 Upload a screenshot of your page</span>
                  <span>{showUpload ? '▲' : '▼'}</span>
                </button>
                {showUpload && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-3 mt-3">Take a screenshot of your Facebook page and upload it — our AI will find your URL automatically!</p>
                    {uploadLoading ? (
                      <div className="flex items-center justify-center py-6 gap-3">
                        <div className="w-6 h-6 border-2 border-gray-200 border-t-[#1877F2] rounded-full animate-spin" />
                        <p className="text-sm text-gray-600 font-medium">AI is reading your screenshot...</p>
                      </div>
                    ) : (
                      <label className="w-full flex flex-col items-center justify-center border-2 border-dashed border-[#1877F2] rounded-xl py-6 px-4 cursor-pointer hover:bg-blue-50 transition-colors">
                        <span className="text-3xl mb-2">📷</span>
                        <span className="text-sm font-bold text-[#1877F2]">Click to upload screenshot</span>
                        <span className="text-xs text-gray-400 mt-1">PNG, JPG, or WEBP</span>
                        <input type="file" accept="image/*" onChange={handleScreenshot} className="hidden" />
                      </label>
                    )}
                  </div>
                )}
              </div>

              {/* LEVEL 4 — GOOGLE SEARCH */}
              <button type="button" onClick={handleGoogleSearch}
                className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:border-gray-400 transition-colors text-left">
                <span className="text-xl">🔍</span>
                <div>
                  <p className="text-sm font-semibold text-gray-700">Search Google for your page</p>
                  <p className="text-xs text-gray-400">Opens a pre-filled Google search to help you find it</p>
                </div>
                <span className="ml-auto text-xs text-gray-400">↗</span>
              </button>

              {/* LEVEL 5 — TRY DIFFERENT NAME */}
              <button type="button" onClick={() => {
                setNoMoreVariations(false);
                setPreviewUrl("");
                setShowVariations(false);
                setVarIndex(0);
              }}
                className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:border-gray-400 transition-colors text-left">
                <span className="text-xl">✏️</span>
                <div>
                  <p className="text-sm font-semibold text-gray-700">Try a different page name</p>
                  <p className="text-xs text-gray-400">Go back and search with a different variation</p>
                </div>
              </button>
            </div>
          )}

          {/* PASTE URL FALLBACK — always visible */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-400 mb-2 font-semibold">Or paste your Facebook URL directly:</p>
            <input
              type="url"
              placeholder="https://www.facebook.com/yourbusiness"
              value={pasteUrl}
              onChange={handlePasteUrl}
              className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1877F2] transition-all"
            />
          </div>
        </>
      ) : (
        /* CONFIRMED */
        <div className="bg-green-50 border-2 border-green-400 rounded-2xl p-5">
          <div className="flex items-center gap-4 mb-3">
            {imgSrc && !imgError ? (
              <img src={imgSrc} alt={confirmedName}
                className="w-14 h-14 rounded-full object-cover border-2 border-green-200 shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#1877F2] flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-xl">f</span>
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3 text-white" />
                </div>
                <p className="font-bold text-green-800 text-sm">Page Confirmed!</p>
              </div>
              <p className="text-sm font-semibold text-gray-800">{confirmedName}</p>
              <p className="text-xs text-green-600 truncate">{previewUrl || value}</p>
            </div>
          </div>
          <button type="button" onClick={handleStartOver}
            className="text-xs text-green-700 hover:underline font-semibold">
            Not right? Start over
          </button>
        </div>
      )}
    </div>
  );
}

export default function SubmitPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [emailError, setEmailError] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    website: "",
    facebook_url: "",
    mainGoal: [],
    postingFrequency: [],
    contentType: [],
  });

  useEffect(() => {
    storeUtmParams();
    trackEvent(EVENTS.INTAKE_STARTED);
  }, []);

  const toggle = (key, val) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(val) ? f[key].filter((x) => x !== val) : [...f[key], val],
    }));

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const validateEmailField = (email) => {
    const trimmed = email?.trim() || "";
    setEmailTouched(true);
    if (!trimmed) { setEmailError("Email is required"); return false; }
    if (!isValidEmail(trimmed)) { setEmailError("Please enter a valid email address"); return false; }
    setEmailError("");
    return true;
  };

  const validateUrl = (url) => {
    if (!url.trim()) return "Please find and confirm your Facebook page above.";
    if (!url.toLowerCase().includes("facebook.com")) return "Please enter a valid Facebook URL.";
    return "";
  };

  const goToStep = (n) => {
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const canNext = () => {
    if (step === 1) return form.name.trim() && form.email.trim() && !emailError && isValidEmail(form.email);
    if (step === 2) return !validateUrl(form.facebook_url);
    if (step === 3) return form.mainGoal.length > 0;
    if (step === 4) return form.postingFrequency.length > 0;
    if (step === 5) return form.contentType.length > 0;
    return true;
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const utm = getStoredUtmParams() || {};
      const res = await fetch(`${API_BASE}/api/audits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: form.name,
          email: form.email,
          facebook_url: form.facebook_url,
          account_type: "Business",
          goals: form.mainGoal.join(", "),
          posting_frequency: form.postingFrequency.join(", "),
          content_type: form.contentType.join(", "),
          utm_source: utm.utm_source || null,
          utm_campaign: utm.utm_campaign || null,
          utm_adset: utm.utm_adset || null,
          utm_ad: utm.utm_ad || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !data?.audit?.id) throw new Error(data?.error || "Audit creation failed");
      const auditId = data.audit.id;
      try {
        await fetch(`${API_BASE}/api/funnel/track`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_type: "intake_submitted",
            email: form.email,
            report_id: auditId,
            facebook_url: form.facebook_url,
            utm_source: utm.utm_source || null,
            utm_campaign: utm.utm_campaign || null,
            metadata: { name: form.name, mainGoal: form.mainGoal, postingFrequency: form.postingFrequency, contentType: form.contentType, website: form.website },
          }),
        });
      } catch (trackErr) { console.error("Tracking failed:", trackErr); }

      localStorage.setItem("pageAuditOrder", JSON.stringify({
        name: form.name,
        email: form.email,
        website: form.website,
        pageUrl: form.facebook_url,
        review_type: "Business",
        mainGoal: form.mainGoal,
        postingFrequency: form.postingFrequency,
        contentType: form.contentType,
        auditId,
      }));
      navigate("/analyzing");
    } catch (err) {
      console.error("[AUDIT ERROR]:", err);
      alert("Error creating audit. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepTitles = [
    "Let's Start With Your Contact Info",
    "Find Your Facebook Business Page",
    "What's Your Main Goal?",
    "How Often Do You Post?",
    "What Content Do You Post Most?",
  ];

  const stepSubs = [
    "Enter your contact info so we can send you your audit.",
    "Search for your page and confirm it's correct — no copy/pasting needed!",
    "Help us understand what you're trying to achieve.",
    "This helps us assess your current posting strategy.",
    "We'll analyze your content performance on this.",
  ];

  return (
    <div className="min-h-screen bg-gray-50 font-sans flex flex-col">
      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <span className="font-bold text-base text-black tracking-tight">PageAudit Pro</span>
        </div>
      </nav>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <StepProgress step={step} />

          <div className="bg-white border border-gray-100 rounded-3xl shadow-sm px-7 py-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">{stepTitles[step - 1]}</h1>
            <p className="text-sm text-gray-400 mb-8">{stepSubs[step - 1]}</p>

            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1.5">Full Name <span className="text-red-400">*</span></label>
                  <input type="text" placeholder="Jane Smith" value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1877F2] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1.5">Email Address <span className="text-red-400">*</span></label>
                  <div className="relative">
                    <input type="email" placeholder="jane@yourbusiness.com" value={form.email}
                      onChange={(e) => { set("email", e.target.value); if (emailError) setEmailError(""); }}
                      onBlur={(e) => validateEmailField(e.target.value)}
                      className={`w-full border-2 rounded-2xl px-4 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-all pr-10 ${emailTouched && isValidEmail(form.email) ? "border-green-300 bg-green-50" : emailTouched && emailError ? "border-red-300" : "border-gray-100 focus:border-[#1877F2]"}`} />
                    {emailTouched && isValidEmail(form.email) && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  {emailTouched && emailError && <p className="text-xs text-red-500 mt-1.5">{emailError}</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1.5">
                    <Globe className="w-4 h-4 inline mr-1 text-[#1877F2]" />
                    Business Website <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input type="url" placeholder="https://yourbusiness.com" value={form.website}
                    onChange={(e) => set("website", e.target.value)}
                    className="w-full border-2 border-gray-100 rounded-2xl px-4 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#1877F2] transition-all" />
                  <p className="text-xs text-green-600 mt-1.5 font-medium">✓ Helps us find your Facebook page + get your free SEO score!</p>
                </div>
              </div>
            )}

            {step === 2 && (
              <FacebookPageLookup
                value={form.facebook_url}
                onChange={(url) => { set("facebook_url", url); setUrlError(""); }}
                email={form.email}
                website={form.website}
              />
            )}

            {step === 3 && (
              <div className="space-y-2">
                {["Grow followers", "Increase engagement", "Generate leads", "Build authority", "Promote a cause"].map((option) => (
                  <MultiCard key={option} selected={form.mainGoal.includes(option)} onClick={() => toggle("mainGoal", option)}>{option}</MultiCard>
                ))}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-2">
                {["Daily", "A few times a week", "Weekly", "Rarely"].map((option) => (
                  <MultiCard key={option} selected={form.postingFrequency.includes(option)} onClick={() => toggle("postingFrequency", option)}>{option}</MultiCard>
                ))}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-2">
                {["Videos", "Images", "Text posts", "Mixed", "Not sure"].map((option) => (
                  <MultiCard key={option} selected={form.contentType.includes(option)} onClick={() => toggle("contentType", option)}>{option}</MultiCard>
                ))}
              </div>
            )}

            <div className={`mt-8 flex ${step > 1 ? "justify-between" : "justify-end"}`}>
              {step > 1 && (
                <button type="button" onClick={() => goToStep(step - 1)}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-black transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
              )}
              <button type="button" disabled={!canNext() || isSubmitting}
                onClick={() => {
                  if (step === 1 && !validateEmailField(form.email)) return;
                  if (step === 2) {
                    const err = validateUrl(form.facebook_url);
                    if (err) { setUrlError(err); return; }
                  }
                  if (step < TOTAL_STEPS) goToStep(step + 1);
                  else handleSubmit();
                }}
                className="inline-flex items-center gap-2 bg-[#1877F2] text-white px-6 py-3 text-sm font-semibold rounded-2xl hover:bg-[#1457C0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-blue-100">
                {step === TOTAL_STEPS ? (isSubmitting ? "Submitting..." : "Get My Page Audit") : "Next"} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


