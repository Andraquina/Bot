const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, () => {
  console.log('BOT IS ONLINE');
});


// 🔘 ONE-TIME SETUP COMMAND (creates permanent button)
client.on(Events.MessageCreate, async message => {

  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!setup') {

    const button = new ButtonBuilder()
      .setCustomId('open_form')
      .setLabel('Start')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await message.channel.send({
      content: 'Click below to enter your info:',
      components: [row]
    });
  }
});


// 📋 HANDLE BUTTON + FORM
client.on(Events.InteractionCreate, async interaction => {
  try {

    // 👉 BUTTON CLICK → OPEN FORM
    if (interaction.isButton() && interaction.customId === 'open_form') {

      const modal = new ModalBuilder()
        .setCustomId('user_form')
        .setTitle('Enter your info');

      const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Your Name')
        .setStyle(TextInputStyle.Short);

      const companyInput = new TextInputBuilder()
        .setCustomId('company')
        .setLabel('Your Company')
        .setStyle(TextInputStyle.Short);

      const row1 = new ActionRowBuilder().addComponents(nameInput);
      const row2 = new ActionRowBuilder().addComponents(companyInput);

      modal.addComponents(row1, row2);

      await interaction.showModal(modal);
      return;
    }

    // 👉 FORM SUBMITTED
    if (interaction.isModalSubmit() && interaction.customId === 'user_form') {

      await interaction.deferReply({ ephemeral: true }); // 🔥 prevents timeout

      const name = interaction.fields.getTextInputValue('name');
      const company = interaction.fields.getTextInputValue('company');

      const member = interaction.member;

      // 🔧 CLEAN FUNCTION
      const clean = str => str.toLowerCase().replace(/\s+/g, '');
      const input = clean(company);

      // 🔍 FIND ROLE
      const role = interaction.guild.roles.cache.find(r => {
        const roleName = clean(r.name);
        return input.includes(roleName) || roleName.includes(input);
      });

      console.log("User typed:", company);
      console.log("Matched role:", role ? role.name : "NONE");

      // ✅ SET NICKNAME (safe)
      try {
        await member.setNickname(`${name} | ${company}`);
      } catch (err) {
        console.log("Nickname not changed (permissions or owner)");
      }

      // ✅ ASSIGN ROLE
      if (role) {
        await member.roles.add(role);
        console.log("Role assigned");
      } else {
        console.log("No role found");
      }

      // ✅ RESPONSE
      await interaction.editReply({
        content: `Welcome ${name} from ${company} 🎉`
      });

    }

  } catch (error) {
    console.error("ERROR:", error);

    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({
        content: "Something went wrong 😅",
        ephemeral: true
      });
    }
  }
});

client.login('MTQ4MzU5NjI4NzcxNzkzMzA1Ng.GpvP3u.zg38FTFs0B35Y3wkz8BJnr6qdALoZhlz1RACFk');