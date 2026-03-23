const {
  Client,
  GatewayIntentBits,
  Events,
  Partials
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// =========================
// ✅ READY
// =========================
client.once(Events.ClientReady, (client) => {
  console.log('🔥 BOT IS ONLINE (DEBUG MODE)');
  console.log(`🤖 Logged in as: ${client.user.tag}`);
  console.log(`🆔 BOT ID: ${client.user.id}`);
});

// =========================
// 🔍 INTERACTION DEBUG
// =========================
client.on(Events.InteractionCreate, async interaction => {

  console.log("📥 INTERACTION RECEIVED:", interaction.type);

  try {

    if (interaction.isChatInputCommand()) {

      console.log("⚡ COMMAND:", interaction.commandName);

      if (interaction.commandName === "broadcast") {

        console.log("✅ BROADCAST TRIGGERED");

        await interaction.reply({
          content: "✅ Broadcast command is working!",
          ephemeral: true
        });

        return;
      }
    }

  } catch (err) {
    console.error("❌ ERROR:", err);
  }
});

client.login(process.env.TOKEN);
