const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  PermissionsBitField,
  ChannelType
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


// 🔘 SETUP COMMAND (run once)
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


// 📋 INTERACTIONS
client.on(Events.InteractionCreate, async interaction => {
  try {

    // =========================
    // 🔘 OPEN FORM
    // =========================
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

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(companyInput)
      );

      await interaction.showModal(modal);
      return;
    }

    // =========================
    // 📋 FORM SUBMIT
    // =========================
    if (interaction.isModalSubmit() && interaction.customId === 'user_form') {

      await interaction.deferReply({ ephemeral: true });

      const name = interaction.fields.getTextInputValue('name');
      const company = interaction.fields.getTextInputValue('company');
      const member = interaction.member;

      const clean = str => str.toLowerCase().replace(/\s+/g, '');
      const input = clean(company);

      let role = interaction.guild.roles.cache.find(r => {
        const roleName = clean(r.name);
        return input.includes(roleName) || roleName.includes(input);
      });

      // nickname
      try {
        await member.setNickname(`${name} | ${company}`);
      } catch {}

      if (role) {
        // ✅ KNOWN COMPANY
        await member.roles.add(role);

        await interaction.editReply({
          content: `Welcome ${name} from ${company} 🎉`
        });

      } else {
        // ❗ NEW COMPANY FLOW

        const pendingRole = interaction.guild.roles.cache.find(r => r.name === "Pending");
        if (pendingRole) {
          await member.roles.add(pendingRole);
        }

        // ✅ SAME CHANNEL MESSAGE (UPDATED)
        interaction.channel.send(
          `👋 Welcome <@${member.id}>\n\n` +
          `It seems you're new to us.\n` +
          `We’re setting everything up for you now.`
        );

        // 🔘 ADMIN BUTTONS
        const approveBtn = new ButtonBuilder()
          .setCustomId(`approve_${member.id}_${company}`)
          .setLabel('Approve')
          .setStyle(ButtonStyle.Success);

        const rejectBtn = new ButtonBuilder()
          .setCustomId(`reject_${member.id}`)
          .setLabel('Reject')
          .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);

        const adminChannel = interaction.guild.channels.cache.find(c => c.name === "admin");

        if (adminChannel) {
          adminChannel.send({
            content:
              `🚨 New company request\n\n` +
              `User: <@${member.id}>\n` +
              `Company: ${company}`,
            components: [row]
          });
        }

        await interaction.editReply({
          content: `Thanks ${name}! We’re setting things up for you ⏳`
        });
      }
    }

    // =========================
    // ✅ APPROVE / REJECT
    // =========================
    if (interaction.isButton()) {

      const parts = interaction.customId.split('_');
      const action = parts[0];

      if (action === "approve") {

        const userId = parts[1];
        const company = parts.slice(2).join('_');

        const member = await interaction.guild.members.fetch(userId);

        const clean = str => str.toLowerCase().replace(/\s+/g, '');

        let role = interaction.guild.roles.cache.find(r =>
          clean(r.name) === clean(company)
        );

        if (!role) {
          role = await interaction.guild.roles.create({
            name: company,
            reason: "Approved new company"
          });
        }

        const pendingRole = interaction.guild.roles.cache.find(r => r.name === "Pending");
        if (pendingRole) {
          await member.roles.remove(pendingRole);
        }

        await member.roles.add(role);

        // 🚀 CREATE CHANNELS
        let category = interaction.guild.channels.cache.find(
          c => c.name === company && c.type === ChannelType.GuildCategory
        );

        if (!category) {
          category = await interaction.guild.channels.create({
            name: company,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
              {
                id: interaction.guild.id,
                deny: [PermissionsBitField.Flags.ViewChannel],
              },
              {
                id: role.id,
                allow: [PermissionsBitField.Flags.ViewChannel],
              }
            ]
          });
        }

        const existingGeneral = interaction.guild.channels.cache.find(
          c => c.name === 'general' && c.parentId === category.id
        );

        if (!existingGeneral) {
          await interaction.guild.channels.create({
            name: 'general',
            type: ChannelType.GuildText,
            parent: category.id
          });
        }

        const existingFiles = interaction.guild.channels.cache.find(
          c => c.name === 'files' && c.parentId === category.id
        );

        if (!existingFiles) {
          await interaction.guild.channels.create({
            name: 'files',
            type: ChannelType.GuildText,
            parent: category.id
          });
        }

        // 📩 DM USER
        try {
          await member.send(`✅ You’ve been approved! Your company space is ready 🎉`);
        } catch {}

        await interaction.reply({
          content: `✅ Approved ${member.user.username}`,
          ephemeral: true
        });
      }

      if (action === "reject") {

        const userId = parts[1];
        const member = await interaction.guild.members.fetch(userId);

        const pendingRole = interaction.guild.roles.cache.find(r => r.name === "Pending");
        if (pendingRole) {
          await member.roles.remove(pendingRole);
        }

        await interaction.reply({
          content: `❌ Rejected ${member.user.username}`,
          ephemeral: true
        });
      }
    }

  } catch (error) {
    console.error("ERROR:", error);
  }
});


client.login(process.env.TOKEN);
