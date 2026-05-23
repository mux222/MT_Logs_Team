// ═══════════════════════════════════════════════════════
//  MT LOGS — Supabase Edge Function
//  discord-notify/index.ts
//
//  هذا الملف يعمل على سيرفر Supabase — الـ webhooks
//  مخفية هنا فقط ولا تظهر أبداً في كود الموقع
// ═══════════════════════════════════════════════════════
//
//  طريقة النشر:
//  1. ثبّت Supabase CLI: npm install -g supabase
//  2. سجل دخول: supabase login
//  3. ربط المشروع: supabase link --project-ref YOUR_PROJECT_REF
//  4. أضف المتغيرات السرية:
//       supabase secrets set DISCORD_TICKET_WEBHOOK="https://discord.com/api/webhooks/..."
//       supabase secrets set DISCORD_BAN_WEBHOOK="https://discord.com/api/webhooks/..."
//  5. انشر الفانكشن: supabase functions deploy discord-notify
// ═══════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { type } = body;

    // جلب الـ Webhooks من متغيرات البيئة السرية
    const TICKET_WEBHOOK = Deno.env.get("DISCORD_TICKET_WEBHOOK");
    const BAN_WEBHOOK = Deno.env.get("DISCORD_BAN_WEBHOOK");

    if (!TICKET_WEBHOOK || !BAN_WEBHOOK) {
      return new Response(
        JSON.stringify({ error: "Webhook URLs not configured in environment" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    let webhookUrl = "";
    let payload: object = {};

    if (type === "ticket") {
      const { subject, creator, ticketId } = body;
      webhookUrl = TICKET_WEBHOOK;
      payload = {
        content: "@everyone",
        embeds: [{
          title: "🎫 تذكرة جديدة تم فتحها",
          description: "**يرجاء الاطلاع عليها في أقرب وقت**",
          color: 0xFF6A00,
          fields: [
            { name: "📋 الموضوع", value: `\`\`\`${subject}\`\`\``, inline: false },
            { name: "🆔 رقم التذكرة", value: `\`${ticketId}\``, inline: true },
            { name: "👤 بواسطة", value: `\`${creator}\``, inline: true },
            { name: "\u200b", value: "**يرجى فتح لوحة التذاكر والرد في أقرب وقت ممكن**", inline: false },
          ],
          footer: { text: "MT Logs System • نظام التذاكر" },
          timestamp: new Date().toISOString()
        }]
      };
    } else if (type === "ban") {
      const { discordId, banType, reason, bannedBy } = body;
      webhookUrl = BAN_WEBHOOK;
      payload = {
        content: "@everyone",
        embeds: [{
          title: "🔨 باند جديد تم إضافته",
          description: "**تم تسجيل حالة باند جديدة في النظام**",
          color: 0xFF0000,
          fields: [
            { name: "🆔 Discord ID", value: `\`\`\`${discordId}\`\`\``, inline: false },
            { name: "📌 النوع", value: `\`${banType}\``, inline: true },
            { name: "📝 السبب", value: `\`\`\`${reason}\`\`\``, inline: false },
            { name: "👮 بواسطة", value: `\`${bannedBy}\``, inline: true },
          ],
          footer: { text: "MT Logs System • نظام الباند" },
          timestamp: new Date().toISOString()
        }]
      };
    } else {
      return new Response(
        JSON.stringify({ error: "Unknown notification type" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const discordRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!discordRes.ok) {
      const errText = await discordRes.text();
      return new Response(
        JSON.stringify({ error: "Discord API error", details: errText }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
