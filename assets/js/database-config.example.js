// คัดลอกไปยัง database-config.js แล้วใช้ค่าจาก Supabase > Connect
// ใส่เฉพาะ Publishable key สำหรับเบราว์เซอร์
SPARK.databaseConfig = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  publishableKey: 'sb_publishable_REPLACE_ME',
  workspace: 'sala-hum-pilot'
};
