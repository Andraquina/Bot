const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// =========================
// 🚀 REGISTER COMMAND ON START
// =========================
client.once(Events.ClientReady, async (client) => {
  console.log('🔥 BOT IS ONLINE');
  console.log(`🆔 BOT ID: ${client.user.id}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('broadcast2')
      .setDescription('Test command')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    console.log("🚀 Registering command directly...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("✅ Command registered SUCCESSFULLY");

  } catch (err) {
    console.error("❌ REGISTER ERROR:", err);
  }
});

// =========================
// 🔍 TEST INTERACTION
// =========================
client.on(Events.InteractionCreate, async interaction => {

  console.log("📥 INTERACTION RECEIVED");

  if (interaction.isChatInputCommand()) {
    console.log("⚡ COMMAND:", interaction.commandName);

    if (interaction.commandName === "broadcast2") {
      await interaction.reply({
        content: "✅ IT FINALLY WORKS",
        ephemeral: true
      });
    }
  }
});

client.login(process.env.TOKEN);
