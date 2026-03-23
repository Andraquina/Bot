const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('broadcast')
    .setDescription('Send a broadcast message')
    .addStringOption(option =>
      option.setName('targets')
        .setDescription('e.g. imi;microsoft or all')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Message to send')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('delay')
        .setDescription('Optional delay (10m, 1h, etc)')
        .setRequired(false))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log('Slash commands registered!');
  } catch (error) {
    console.error(error);
  }
})();
