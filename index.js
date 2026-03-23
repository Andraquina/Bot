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

client.once(Events.ClientReady, () => {
  console.log('🔥 BOT IS ONLINE (DEBUG MODE)');
});

// =========================
// 🔍 DEBUG INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {

  console.log("📥 INTERACTION RECEIVED:", interaction.type);

  try {

    // ONLY slash commands
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
