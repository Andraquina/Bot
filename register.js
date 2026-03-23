const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('broadcast')
    .setDescription('Send a broadcast message')
    .addStringOption(option =>
      option.setName('targets')
        .setDescription('Select company')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Message to send')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('delay')
        .setDescription('Optional delay')
        .setRequired(false)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID // 🔥 ADD THIS
      ),
      { body: commands }
    );

    console.log('Slash commands registered instantly!');
  } catch (error) {
    console.error(error);
  }
})();
