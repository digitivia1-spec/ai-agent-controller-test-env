    // --- INJECT TRANSLATIONS FOR PASSWORD CHANGE ---
    (function injectPasswordTranslations() {
        if (window.LANG_EN && window.LANG_EN.modals && window.LANG_EN.modals.profile) {
            Object.assign(window.LANG_EN.modals.profile, {
                label_password: "Change Password",
                placeholder_new_pass: "New Password",
                placeholder_confirm_pass: "Confirm Password",
                btn_update_pass: "Update Password",
                pass_updated_success: "Password updated successfully!",
                pass_mismatch: "Passwords do not match.",
                pass_short: "Password must be at least 6 characters.",
                pass_updating: "Updating..."
            });
        }
        if (window.LANG_AR && window.LANG_AR.modals && window.LANG_AR.modals.profile) {
            Object.assign(window.LANG_AR.modals.profile, {
                label_password: "تغيير كلمة المرور",
                placeholder_new_pass: "كلمة المرور الجديدة",
                placeholder_confirm_pass: "تأكيد كلمة المرور",
                btn_update_pass: "تحديث كلمة المرور",
                pass_updated_success: "تم تحديث كلمة المرور بنجاح!",
                pass_mismatch: "كلمات المرور غير متطابقة.",
                pass_short: "يجب أن تكون كلمة المرور 6 أحرف على الأقل.",
                pass_updating: "جاري التحديث..."
            });
        }

        if (window.LANG_EN) {
            window.LANG_EN.legal = {
                links: {
                    privacy: "Privacy Policy",
                    terms: "Terms of Service",
                    cookies: "Cookie Policy",
                    security: "Security & Compliance"
                },
                last_updated: "Last updated: April 12, 2026",
                retention_notice: "We keep customer data for one year only. After one year, data is permanently deleted from active systems and backups according to retention controls.",
                providers_notice: "Core infrastructure and integrations include Supabase, OpenAI, GitHub, Meta Developer Platform, and WhatsApp Business Platform.",
                privacy: {
                    title: "Privacy Policy",
                    intro_title: "Overview",
                    intro_text: "This policy explains how Omnio by Digitivia collects, uses, stores, and protects personal and operational data processed through the platform.",
                    collect_title: "Data We Collect",
                    collect_text: "We may process profile data, organization settings, contact details, message content, usage logs, and integration metadata required to operate AI agents and communication channels.",
                    use_title: "How We Use Data",
                    use_text: "Data is used to deliver services, maintain account security, generate analytics, support automations, troubleshoot issues, and comply with applicable legal obligations.",
                    retention_title: "Retention and Deletion",
                    retention_text: "Customer-related data is retained for a maximum of one year, then removed permanently under scheduled deletion policies, unless longer retention is required by law.",
                    rights_title: "Access and Contact",
                    rights_text: "You can request data correction or deletion, and ask privacy questions through official support channels listed by your organization administrator."
                },
                terms: {
                    title: "Terms of Service",
                    intro_title: "Service Scope",
                    intro_text: "These terms govern access to and use of Omnio by Digitivia, including connected channels, dashboards, analytics, and automation features.",
                    accept_title: "Acceptance",
                    accept_text: "By using the service, you agree to these terms and confirm that you have authority to act on behalf of your organization.",
                    use_title: "Permitted Use",
                    use_text: "You must use the platform lawfully, avoid abusive or harmful content, and follow channel-provider requirements and local regulations.",
                    account_title: "Account Responsibility",
                    account_text: "You are responsible for account credentials, workspace access, connected integrations, and activity performed by authorized users.",
                    liability_title: "Availability and Liability",
                    liability_text: "The service is provided on a commercially reasonable basis. We continuously improve reliability but cannot guarantee uninterrupted availability in all cases.",
                    changes_title: "Updates to Terms",
                    changes_text: "We may update these terms when features, legal requirements, or provider rules change. Continued use after updates indicates acceptance."
                },
                cookies: {
                    title: "Cookie Policy",
                    intro_title: "Overview",
                    intro_text: "This policy explains how cookies and similar technologies are used to keep the platform secure, functional, and measurable.",
                    what_title: "What Cookies Are",
                    what_text: "Cookies are small browser files used to remember preferences, maintain sessions, and improve user experience across visits.",
                    types_title: "Types We Use",
                    types_text: "We use essential cookies for authentication and security, preference cookies for language/theme settings, and performance cookies for usage insights.",
                    manage_title: "Managing Cookies",
                    manage_text: "You can manage cookie settings through your browser. Disabling essential cookies may affect login, session continuity, and core platform features.",
                    third_party_title: "Third-Party Cookies",
                    third_party_text: "Integrated providers may set technical cookies required for connected services and security controls under their own published policies."
                },
                security: {
                    title: "Security & Compliance",
                    intro_title: "Security Program",
                    intro_text: "Omnio by Digitivia applies layered security controls to protect data confidentiality, integrity, and service availability.",
                    controls_title: "Access and Monitoring Controls",
                    controls_text: "We enforce role-based access, audit logging, credential safeguards, and monitoring to detect unauthorized actions and service anomalies.",
                    encryption_title: "Encryption and Data Protection",
                    encryption_text: "Data is protected in transit and at rest through provider-supported encryption controls and secure operational practices.",
                    incidents_title: "Incident Response",
                    incidents_text: "Security events are triaged, investigated, and remediated using incident-response procedures with documented corrective actions.",
                    compliance_title: "Compliance Alignment",
                    compliance_text: "Our controls are aligned with industry best practices and contractual commitments, including data minimization, retention limits, and access accountability.",
                    disclosure_title: "Responsible Disclosure",
                    disclosure_text: "If you identify a potential vulnerability, report it through official support channels for coordinated validation and remediation."
                }
            };
        }

        if (window.LANG_AR) {
            window.LANG_AR.legal = {
                links: {
                    privacy: "سياسة الخصوصية",
                    terms: "شروط الخدمة",
                    cookies: "سياسة ملفات تعريف الارتباط",
                    security: "الأمن والامتثال"
                },
                last_updated: "آخر تحديث: 5 مارس 2026",
                retention_notice: "نحتفظ ببيانات العملاء لمدة سنة واحدة فقط. بعد مرور سنة يتم حذف البيانات نهائياً من الأنظمة النشطة والنسخ الاحتياطية وفق ضوابط الاحتفاظ.",
                providers_notice: "تشمل البنية الأساسية والتكاملات: Supabase و OpenAI و GitHub ومنصة Meta Developer ومنصة WhatsApp Business.",
                privacy: {
                    title: "سياسة الخصوصية",
                    intro_title: "نظرة عامة",
                    intro_text: "توضح هذه السياسة كيفية جمع Omnio by Digitivia للبيانات الشخصية والتشغيلية واستخدامها وتخزينها وحمايتها داخل المنصة.",
                    collect_title: "البيانات التي نجمعها",
                    collect_text: "قد نعالج بيانات الملف الشخصي وإعدادات المؤسسة وبيانات التواصل ومحتوى الرسائل وسجلات الاستخدام وبيانات التكامل اللازمة لتشغيل الوكلاء وقنوات التواصل.",
                    use_title: "كيف نستخدم البيانات",
                    use_text: "تُستخدم البيانات لتقديم الخدمة وحماية الحسابات وإنشاء التحليلات وتشغيل الأتمتة ومعالجة المشكلات والالتزام بالمتطلبات القانونية.",
                    retention_title: "الاحتفاظ والحذف",
                    retention_text: "تُحفظ بيانات العملاء لمدة أقصاها سنة واحدة، ثم يتم حذفها نهائياً وفق سياسات حذف مجدولة ما لم يفرض القانون مدة أطول.",
                    rights_title: "الوصول والتواصل",
                    rights_text: "يمكنك طلب تصحيح البيانات أو حذفها وطرح استفسارات الخصوصية عبر قنوات الدعم الرسمية لدى مسؤول المؤسسة."
                },
                terms: {
                    title: "شروط الخدمة",
                    intro_title: "نطاق الخدمة",
                    intro_text: "تنظم هذه الشروط استخدام Omnio by Digitivia بما يشمل القنوات المرتبطة ولوحات التحكم والتحليلات وميزات الأتمتة.",
                    accept_title: "القبول",
                    accept_text: "باستخدامك للخدمة فإنك توافق على هذه الشروط وتؤكد أن لديك صلاحية التمثيل عن مؤسستك.",
                    use_title: "الاستخدام المسموح",
                    use_text: "يجب استخدام المنصة بشكل قانوني وتجنب المحتوى الضار أو المسيء والالتزام بمتطلبات مزودي القنوات واللوائح المحلية.",
                    account_title: "مسؤولية الحساب",
                    account_text: "أنت مسؤول عن بيانات الدخول وصلاحيات المستخدمين والتكاملات المتصلة والأنشطة المنفذة من الحسابات المصرح بها.",
                    liability_title: "التوفر والمسؤولية",
                    liability_text: "يتم تقديم الخدمة على أساس تجاري معقول. نعمل باستمرار على تحسين الاعتمادية لكن لا يمكن ضمان التوفر دون انقطاع في جميع الحالات.",
                    changes_title: "تحديث الشروط",
                    changes_text: "قد نقوم بتحديث هذه الشروط عند تغير الميزات أو المتطلبات القانونية أو سياسات المزودين. الاستمرار في الاستخدام يعني قبول التحديثات."
                },
                cookies: {
                    title: "سياسة ملفات تعريف الارتباط",
                    intro_title: "نظرة عامة",
                    intro_text: "توضح هذه السياسة كيفية استخدام ملفات تعريف الارتباط والتقنيات المشابهة للحفاظ على أمان المنصة ووظائفها وقياس الأداء.",
                    what_title: "ما هي ملفات تعريف الارتباط",
                    what_text: "هي ملفات صغيرة في المتصفح تُستخدم لتذكر التفضيلات والحفاظ على الجلسات وتحسين تجربة الاستخدام بين الزيارات.",
                    types_title: "الأنواع التي نستخدمها",
                    types_text: "نستخدم ملفات أساسية للمصادقة والأمان، وملفات تفضيل للغة والمظهر، وملفات أداء لقياس استخدام المنصة.",
                    manage_title: "إدارة الملفات",
                    manage_text: "يمكنك إدارة إعدادات ملفات تعريف الارتباط من المتصفح. تعطيل الملفات الأساسية قد يؤثر على تسجيل الدخول واستمرارية الجلسة والميزات الرئيسية.",
                    third_party_title: "ملفات الطرف الثالث",
                    third_party_text: "قد يضع مزودو التكامل ملفات تقنية مطلوبة للتشغيل الآمن للخدمات المتصلة وفق سياساتهم المنشورة."
                },
                security: {
                    title: "الأمن والامتثال",
                    intro_title: "برنامج الأمان",
                    intro_text: "تطبق Omnio by Digitivia ضوابط أمنية متعددة الطبقات لحماية سرية البيانات وسلامتها وتوفر الخدمة.",
                    controls_title: "ضوابط الوصول والمراقبة",
                    controls_text: "نطبق صلاحيات مبنية على الأدوار وسجلات تدقيق وحماية للاعتمادات ومراقبة لاكتشاف أي نشاط غير مصرح به أو أعطال تشغيلية.",
                    encryption_title: "التشفير وحماية البيانات",
                    encryption_text: "تتم حماية البيانات أثناء النقل والتخزين عبر إمكانات التشفير لدى المزودين وممارسات تشغيلية آمنة.",
                    incidents_title: "الاستجابة للحوادث",
                    incidents_text: "يتم فرز الأحداث الأمنية والتحقيق فيها ومعالجتها وفق إجراءات استجابة موثقة مع إجراءات تصحيحية.",
                    compliance_title: "مواءمة الامتثال",
                    compliance_text: "ضوابطنا متوافقة مع أفضل الممارسات الصناعية والالتزامات التعاقدية، بما يشمل تقليل البيانات وحدود الاحتفاظ ومساءلة الوصول.",
                    disclosure_title: "الإفصاح المسؤول",
                    disclosure_text: "إذا اكتشفت ثغرة محتملة، يرجى الإبلاغ عبر قنوات الدعم الرسمية لتأكيدها ومعالجتها بشكل منظم."
                }
            };
        }

        if (typeof applyTranslations === 'function') applyTranslations();
    })();
