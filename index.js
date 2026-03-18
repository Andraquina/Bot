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
    // 🔘 BUTTON → OPEN FORM
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

        const waitingChannel = interaction.guild.channels.cache.find(
          c => c.name === "waiting-room"
        );

        if (waitingChannel) {
          waitingChannel.send(
            `Hey <@${member.id}> 👋\n\n` +
            `It seems you're new to us.\n` +
            `Give us a few minutes to set everything up for you.\n` +
            `This will take approximately a few minutes ⏳`
          );
        }

        // 🔘 ADMIN APPROVAL BUTTONS
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
    // ✅ APPROVE / REJECT SYSTEM
    // =========================
    if (interaction.isButton()) {

      const parts = interaction.customId.split('_');
      const action = parts[0];

      if (action === "approve") {

        const userId = parts[1];
        const company = parts.slice(2).join('_'); // handles spaces

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

        // 📩 DM USER
        try {
          await member.send(`✅ You’ve been approved! Welcome to ${company} 🎉`);
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
