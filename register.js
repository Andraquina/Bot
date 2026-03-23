const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("🧹 Clearing ALL commands (GLOBAL + GUILD)");

    // ❌ remove GLOBAL commands
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: [] }
    );

    // ❌ remove GUILD commands
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: [] }
    );

    console.log("✅ EVERYTHING CLEARED");
  } catch (err) {
    console.error(err);
  }
})();
