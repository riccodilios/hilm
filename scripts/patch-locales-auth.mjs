import fs from 'node:fs'

function patch(file, patcher) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  patcher(j)
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n')
}

patch('src/i18n/locales/en.json', (j) => {
  Object.assign(j.auth, {
    verifying: 'Verifying your account…',
    verified: 'Email verified — welcome to Hilm',
    callbackMissingSession: 'No session found. Open the link from your email again.',
    callbackFailed: 'Authentication failed',
    recoveryReady: 'Choose a new password',
    checkEmail: 'Check your email to verify your account',
    forgotTitle: 'Reset password',
    forgotSubtitle: 'We will email you a secure reset link.',
    sendReset: 'Send reset link',
    resetEmailSent: 'Reset email sent — check your inbox',
    resetTitle: 'Set a new password',
    resetSubtitle: 'Choose a strong password for your Hilm account.',
    updatePassword: 'Update password',
    passwordUpdated: 'Password updated',
    forgotPassword: 'Forgot password?',
  })
  j.reminders = {
    '5m': '5 minutes before',
    '15m': '15 minutes before',
    '30m': '30 minutes before',
    '1h': '1 hour before',
    sameDayMorning: 'Same day (morning)',
    '1d': '1 day before',
    '2d': '2 days before',
    '1w': '1 week before',
    custom: 'Custom reminder',
  }
  Object.assign(j.settings, {
    notifications: 'Notifications',
    notificationsDesc: 'Email, push, and reminder defaults.',
    emailReminders: 'Email reminders',
    emailRemindersDesc: 'Send task reminder emails even when Hilm is closed.',
    pushNotifications: 'Push notifications',
    pushNotificationsDesc: 'Future-ready push channel (enable when configured).',
    defaultReminder: 'Default reminder timing',
    perProject: 'Email reminders per project',
  })
  Object.assign(j.tasks, {
    dueTime: 'Due time',
    reminder: 'Reminder',
    projectRequired: 'Project is required',
  })
})

patch('src/i18n/locales/ar.json', (j) => {
  Object.assign(j.auth, {
    verifying: 'جارٍ التحقق من حسابك…',
    verified: 'تم التحقق من البريد — مرحباً بك في Hilm',
    callbackMissingSession: 'لم يتم العثور على جلسة. افتح الرابط من بريدك مجدداً.',
    callbackFailed: 'فشل المصادقة',
    recoveryReady: 'اختر كلمة مرور جديدة',
    checkEmail: 'تحقق من بريدك لتأكيد الحساب',
    forgotTitle: 'إعادة تعيين كلمة المرور',
    forgotSubtitle: 'سنرسل لك رابط إعادة تعيين آمناً.',
    sendReset: 'إرسال رابط إعادة التعيين',
    resetEmailSent: 'تم إرسال البريد — تحقق من صندوق الوارد',
    resetTitle: 'تعيين كلمة مرور جديدة',
    resetSubtitle: 'اختر كلمة مرور قوية لحساب Hilm.',
    updatePassword: 'تحديث كلمة المرور',
    passwordUpdated: 'تم تحديث كلمة المرور',
    forgotPassword: 'نسيت كلمة المرور؟',
  })
  j.reminders = {
    '5m': 'قبل ٥ دقائق',
    '15m': 'قبل ١٥ دقيقة',
    '30m': 'قبل ٣٠ دقيقة',
    '1h': 'قبل ساعة',
    sameDayMorning: 'نفس اليوم (صباحاً)',
    '1d': 'قبل يوم',
    '2d': 'قبل يومين',
    '1w': 'قبل أسبوع',
    custom: 'تذكير مخصص',
  }
  Object.assign(j.settings, {
    notifications: 'الإشعارات',
    notificationsDesc: 'البريد والدفع والتذكيرات الافتراضية.',
    emailReminders: 'تذكيرات البريد',
    emailRemindersDesc: 'أرسل تذكيرات المهام حتى عند إغلاق Hilm.',
    pushNotifications: 'إشعارات الدفع',
    pushNotificationsDesc: 'قناة دفع جاهزة للمستقبل (عند التفعيل).',
    defaultReminder: 'توقيت التذكير الافتراضي',
    perProject: 'تذكيرات البريد لكل مشروع',
  })
  Object.assign(j.tasks, {
    dueTime: 'وقت الاستحقاق',
    reminder: 'التذكير',
    projectRequired: 'المشروع مطلوب',
  })
})

console.log('locales patched')
