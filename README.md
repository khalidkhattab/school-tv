# شاشة المدرسة الذكية (School Digital Signage)

افتح `index.html` على الشاشة (يُفضّل عبر خادم ويب بسيط أو استضافة ثابتة مثل GitHub Pages) ثم اضغط **F** لملء الشاشة.
بدون ربط جدول تظهر بيانات تجريبية. اضغط **S** للإعدادات ولصق رابط Google Sheets
(يجب مشاركته «أي شخص لديه الرابط – عارض»).

اختصارات: S إعدادات · F ملء الشاشة · M الصوت · T المظهر · 1/2/3 المراحل.
للاختبار: `index.html?at=2026-10-11T09:57` لمحاكاة تاريخ ووقت.

## أسماء الأوراق (Tabs) وأعمدتها (الصف الأول عناوين بالإنجليزية)
| الورقة | الأعمدة |
|---|---|
| `settings` | key, value — المفاتيح: school_name, stage_name, logo, display_mode (regular/exams/staff), theme (royal/sapphire/emerald/light), stage (primary/middle/secondary), lat, lon, weekend (مثال 5,6), default_duration, poll_seconds |
| `cards` | title, content, image (رابط صورة/فيديو/YouTube/Drive), type (اختياري: image/video/youtube/drive/iframe/text), duration (ثوانٍ), active, start_date, end_date |
| `news` | text, priority (normal/high/emergency), active |
| `exams` | date (YYYY-MM-DD), grade, subject, time |
| `staff` | title, date, start, end, location, active |
| `schedule` | stage, name, start, end, type (class/break/prayer) — اختياري لاستبدال الجداول الجاهزة |

أي إعلان `priority = emergency` يُظهر شاشة الطوارئ فوراً مع صافرة، ويختفي بإلغاء تفعيله أو حذفه.
