import { useQuery } from "@tanstack/react-query";

const sections = [
  {
    title: "⚙️ مميزات البوت",
    color: "text-emerald-400",
    border: "border-emerald-800",
    cmds: [
      ["حذف الروابط تلقائياً", "يحذف الرابط ويزيل المرسل فوراً"],
      ["منع تحويل القنوات", "حذف أي رسالة محوّلة من قناة فوراً"],
      ["Anti-Spam", "منع الإزعاج والرسائل المتكررة تلقائياً"],
      ["نظام الإنذارات", "3 إنذارات ثم إزالة تلقائية عند السب"],
      ["ترحيب تلقائي", "رسالة ترحيب للأعضاء الجدد"],
      ["وداع تلقائي", "رسالة توديع عند مغادرة أي عضو"],
      ["شخصية البوت", "ردود لطيفة وأنثوية تلقائية"],
    ],
  },
  {
    title: "🛡️ نظام الحماية",
    color: "text-red-400",
    border: "border-red-900",
    cmds: [
      ["رابط من عضو", "حذف الرسالة وإزالة المرسل فوراً 🚫"],
      ["تحويل من قناة", "حذف الرسالة فورياً 📵"],
      ["سب أو كلمة سيئة", "إنذار أول ⚠️"],
      ["سب مرة ثانية", "إنذار ثاني 🚨"],
      ["سب مرة ثالثة", "إزالة تلقائية من المجموعة 🔨"],
      ["رسائل متكررة", "تحذير Anti-Spam 🔁"],
      ["فيضان رسائل", "تحذير Anti-Spam 🚨"],
    ],
  },
  {
    title: "📌 أوامر الإدارة !",
    color: "text-yellow-400",
    border: "border-yellow-900",
    cmds: [
      ["!تثبيت", "تثبيت رسالة (رد عليها مع الأمر)"],
      ["!الغاء_تثبيت", "إلغاء تثبيت الرسالة"],
      ["!منشن [رسالة]", "منشن جميع أعضاء المجموعة"],
      ["!المتصلين", "عرض عدد أعضاء المجموعة"],
      ["!الحالة", "معلومات عامة عن المجموعة"],
      ["!انذار @منشن", "إعطاء إنذار يدوي"],
      ["!مسح @منشن", "مسح إنذارات عضو"],
      ["!طرد @منشن", "طرد عضو من المجموعة"],
      ["!ترقية @منشن", "ترقية عضو إلى مشرف"],
      ["!تنزيل @منشن", "إزالة رتبة المشرف"],
      ["!عدد", "عدد أعضاء الجروب"],
      ["!سكر / !فتح", "تفعيل/إلغاء حجب الروابط"],
    ],
  },
  {
    title: "💬 أوامر التفاعل !",
    color: "text-pink-400",
    border: "border-pink-900",
    cmds: [
      ["!حب", "رسالة حب عشوائية 💕"],
      ["!غزل", "رسالة غزل رومانسية 🌹"],
      ["!مشاعر", "رسالة مشاعر جميلة 💫"],
      ["!حكمة", "حكمة يومية مفيدة 📖"],
      ["!نكتة", "نكتة مضحكة 😂"],
      ["!لعبة حجر/ورقة/مقص", "لعبة ترفيهية مع البوت 🎮"],
    ],
  },
  {
    title: "🎭 ترفيه الجروب (بدون بادئة)",
    color: "text-green-400",
    border: "border-green-900",
    cmds: [
      ["مزه / نكتة / ضحكني", "نكتة مع منشن عشوائي 😂"],
      ["منشن / منشن عشوائي", "منشن شخص عشوائي"],
      ["منشن الكل", "منشن جميع الأعضاء"],
      ["مدح / روست", "مدح أو هجوم مزحي"],
      ["من الغبي / من الذكي / من يستاهل", "اختيار عشوائي"],
      ["رولت / من الضحية", "ضحية اليوم عشوائياً"],
      ["تحدي [النص]", "تحدي لشخص عشوائي"],
      ["شغل [اسم أغنية]", "بحث عن أغنية على يوتيوب 🎵"],
    ],
  },
  {
    title: "💰 نظام الفلوس .",
    color: "text-amber-400",
    border: "border-amber-900",
    cmds: [
      [".فلوسي", "عرض رصيدك الحالي"],
      [".عمل", "اكسب فلوس (كل ساعة)"],
      [".تحويل @شخص المبلغ", "تحويل فلوس لعضو آخر"],
      [".متجر", "عرض المتجر والمنتجات"],
      [".شراء [رقم]", "شراء منتج من المتجر"],
    ],
  },
  {
    title: "📊 نظام المستويات .",
    color: "text-blue-400",
    border: "border-blue-900",
    cmds: [
      [".مستواي", "عرض مستواك وتقدمك"],
      [".ترتيبي", "ترتيبك بين الأعضاء"],
      [".الأكثر تفاعل", "أكثر 10 أعضاء نشاطاً"],
    ],
  },
  {
    title: "🎮 الألعاب .",
    color: "text-purple-400",
    border: "border-purple-900",
    cmds: [
      [".حجر / .ورقة / .مقص", "لعبة حجر ورقة مقص (ربح = +10 عملة)"],
      [".حقيقة", "سؤال حقيقة لعضو عشوائي"],
      [".سؤال", "سؤال عشوائي لعضو"],
      [".احزر", "لعبة تخمين الكلمة (ربح = +50 عملة)"],
    ],
  },
  {
    title: "🎨 الوسائط والذكاء .",
    color: "text-cyan-400",
    border: "border-cyan-900",
    cmds: [
      [".ملصق (مع صورة)", "تحويل صورة إلى ملصق"],
      [".tts النص", "تحويل نص إلى رسالة صوتية"],
      [".صورة كلمة", "بحث عن صورة من الإنترنت"],
      [".ذكاء [سؤال]", "إجابة ذكاء اصطناعي"],
      [".مساعدة", "قائمة الأوامر الكاملة"],
    ],
  },
  {
    title: "🔐 أوامر المالك فقط (780948255)",
    color: "text-violet-400",
    border: "border-violet-900",
    cmds: [
      ["!تسجيل_رقم_جديد", "إعادة تشغيل الجلسة وعرض QR جديد في لوحة التحكم"],
      ["!تسجيل_رقم_جديد [رقم]", "توليد كود 8 أرقام لربط رقم بعينه"],
      ["مثال", "!تسجيل_رقم_جديد 9647809XXXXX"],
    ],
  },
  {
    title: "⚠️ قوانين المجموعة",
    color: "text-orange-400",
    border: "border-orange-900",
    cmds: [
      ["🚫 الروابط", "يمنع إرسال أي رابط"],
      ["📵 التحويل", "يمنع تحويل الرسائل من القنوات"],
      ["🤬 السب والشتم", "3 إنذارات ثم إزالة تلقائية"],
      ["🔁 الإزعاج", "منع الرسائل المتكررة والفيضان"],
      ["🤝 الاحترام", "احترام جميع أعضاء المجموعة"],
    ],
  },
];

export default function Home() {
  const { data } = useQuery({
    queryKey: ["/api/qr"],
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "connected") return false;
      if (status === "waiting_pairing") return 2000;
      return 3000;
    },
  });

  const status = data?.status ?? "disconnected";
  const qrImage = data?.qr;
  const pairingCode: string | null = data?.pairingCode ?? null;

  const statusMap: Record<string, { text: string; dot: string; label: string }> = {
    connected:      { text: "text-green-400",  dot: "bg-green-500 animate-pulse",  label: "متصل ويعمل" },
    waiting_qr:     { text: "text-yellow-400", dot: "bg-yellow-500 animate-pulse", label: "في انتظار مسح QR" },
    waiting_pairing:{ text: "text-purple-400", dot: "bg-purple-500 animate-pulse", label: "في انتظار إدخال الكود" },
    disconnected:   { text: "text-red-400",    dot: "bg-red-500",                  label: "غير متصل" },
    restarting:     { text: "text-blue-400",   dot: "bg-blue-500 animate-pulse",   label: "جاري إعادة التشغيل..." },
    starting:       { text: "text-blue-400",   dot: "bg-blue-500 animate-pulse",   label: "جاري التشغيل..." },
    error:          { text: "text-red-400",    dot: "bg-red-500",                  label: "خطأ في الاتصال" },
  };

  const s = statusMap[status] ?? statusMap.disconnected;

  return (
    <div dir="rtl" className="min-h-screen bg-gray-950 text-white px-4 py-8 flex flex-col items-center gap-6">

      {/* Header */}
      <div className="text-center w-full max-w-sm">
        <div className="text-5xl mb-3">🤖</div>
        <h1 className="text-3xl font-bold text-green-400">Alqartha dia Bot</h1>
        <p className="text-gray-400 text-sm mt-1">بوت إدارة وحماية متكامل للمجموعات</p>
        <div className="mt-3 text-xs text-gray-600 leading-relaxed">
          ━━━━━━━━━━━━━━━━━━━━━━
        </div>
      </div>

      {/* Welcome Banner */}
      <div className="w-full max-w-sm bg-gradient-to-br from-green-950 to-gray-900 border border-green-800 rounded-2xl p-5 text-center">
        <p className="text-green-300 text-sm leading-relaxed">
          مرحبًا بكم في بوت الإدارة والحماية الخاص بالمجموعات.<br/>
          يوفر الحماية والتنظيم والأدوات الذكية لمساعدة المشرفين.
        </p>
      </div>

      {/* Status card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col items-center gap-4 w-full max-w-sm shadow-xl">
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${s.dot}`} />
          <span className={`font-semibold text-lg ${s.text}`}>{s.label}</span>
        </div>

        {status === "connected" && (
          <div className="text-center">
            <div className="text-5xl mb-2">✅</div>
            <p className="text-green-400 font-bold text-xl">البوت يعمل على مدار الساعة!</p>
            <p className="text-gray-400 text-sm mt-1">جاهز لتنظيم وحماية مجموعاتك</p>
          </div>
        )}

        {/* Pairing Code Mode */}
        {status === "waiting_pairing" && pairingCode && (
          <div className="flex flex-col items-center gap-3 w-full">
            <div className="text-4xl">📱</div>
            <p className="text-purple-300 text-sm text-center font-semibold">كود ربط الرقم الجديد</p>
            <div className="bg-gray-800 border-2 border-purple-600 rounded-2xl px-6 py-4 text-center">
              <p className="text-3xl font-bold tracking-[0.3em] text-purple-300 font-mono">
                {pairingCode}
              </p>
            </div>
            <div className="text-xs text-gray-400 text-center leading-relaxed">
              <p>1. افتح واتساب على الرقم الجديد</p>
              <p>2. الإعدادات ← الأجهزة المرتبطة</p>
              <p>3. ربط جهاز ← استخدام رقم الهاتف</p>
              <p>4. أدخل الكود أعلاه</p>
            </div>
            <p className="text-gray-600 text-xs">ينتهي الكود بعد دقيقة</p>
          </div>
        )}

        {status === "waiting_pairing" && !pairingCode && (
          <div className="w-full flex flex-col items-center gap-2 animate-pulse">
            <div className="text-3xl">⏳</div>
            <p className="text-purple-400 text-sm">جاري توليد كود الربط...</p>
          </div>
        )}

        {status === "waiting_qr" && qrImage && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-gray-300 text-sm text-center">
              واتساب ← الأجهزة المرتبطة ← ربط جهاز ← امسح الرمز
            </p>
            <div className="bg-white p-3 rounded-xl">
              <img src={qrImage} alt="QR Code" className="w-56 h-56" />
            </div>
            <p className="text-gray-500 text-xs">ينتهي الرمز بعد دقيقة، يتجدد تلقائياً</p>
          </div>
        )}

        {status === "waiting_qr" && !qrImage && (
          <div className="w-56 h-56 bg-gray-800 rounded-xl flex items-center justify-center animate-pulse">
            <p className="text-gray-500 text-sm">جاري توليد رمز QR...</p>
          </div>
        )}

        {status === "restarting" && (
          <div className="text-center">
            <div className="text-4xl mb-2 animate-spin">🔄</div>
            <p className="text-blue-400 text-sm font-semibold">جاري إعادة تشغيل الجلسة...</p>
            <p className="text-gray-500 text-xs mt-1">انتظر لحظة حتى يظهر الكود أو QR</p>
          </div>
        )}

        {(status === "disconnected" || status === "starting" || status === "error") && (
          <div className="text-center">
            <div className="text-4xl mb-2">🔌</div>
            <p className="text-gray-400 text-sm">البوت يحاول الاتصال... انتظر لحظة</p>
          </div>
        )}
      </div>

      {/* Bot Info */}
      <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <p className="text-xs font-bold mb-3 uppercase tracking-wide text-gray-400">📊 معلومات البوت</p>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between border-b border-gray-800 pb-2">
            <span className="text-gray-400 text-xs">الاسم</span>
            <span className="text-green-300 text-xs font-mono">Alqartha dia Bot</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-2">
            <span className="text-gray-400 text-xs">المطوّر</span>
            <span className="text-green-300 text-xs font-mono">المهندس ضياء نذير غلاب</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-2">
            <span className="text-gray-400 text-xs">رقم التواصل</span>
            <span className="text-green-300 text-xs font-mono">780948255</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400 text-xs">الإصدار</span>
            <span className="text-green-300 text-xs font-mono">2026 v3.0</span>
          </div>
        </div>
      </div>

      {/* All Feature Sections */}
      <div className="w-full max-w-sm flex flex-col gap-4">
        {sections.map((sec) => (
          <div key={sec.title} className={`bg-gray-900 border ${sec.border} rounded-2xl p-5`}>
            <p className={`text-xs font-bold mb-3 uppercase tracking-wide ${sec.color}`}>{sec.title}</p>
            <div className="flex flex-col gap-2 text-sm">
              {sec.cmds.map(([cmd, desc], i) => (
                <div
                  key={i}
                  className={`flex justify-between gap-2 ${i < sec.cmds.length - 1 ? "border-b border-gray-800 pb-2" : ""}`}
                >
                  <span className={`font-mono text-xs ${sec.color}`}>{cmd}</span>
                  <span className="text-gray-400 text-xs text-left">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="w-full max-w-sm text-center border-t border-gray-800 pt-4">
        <p className="text-gray-500 text-xs">نشكر لكم استخدام هذا البوت ونتمنى لكم تجربة رائعة 🤍</p>
        <p className="text-gray-700 text-xs mt-1">© جميع الحقوق محفوظة - المهندس ضياء 2026</p>
      </div>
    </div>
  );
}
