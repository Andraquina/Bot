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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, () => {
  console.log('BOT IS ONLINE');
});


// =========================
// 🧠 SMART COMPANY MATCHING
// =========================

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractKeywords(str) {
  return str.toLowerCase().split(/\s+/);
}

function isSameCompany(a, b) {
  const na = normalize(a);
  const nb = normalize(b);

  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const wordsA = extractKeywords(a);
  const wordsB = extractKeywords(b);

  return wordsA.some(w => wordsB.includes(w));
}


// =========================
// 👋 ON USER JOIN (HYBRID)
// =========================
client.on(Events.GuildMemberAdd, async member => {

  const button = new ButtonBuilder()
    .setCustomId('open_form')
    .setLabel('Start Setup')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  try {
    await member.send({
      content: "👋 Welcome! Click below to get started:",
      components: [row]
    });
  } catch {
    const channel = member.guild.channels.cache.find(c => c.name === "welcome");

    if (channel) {
      channel.send({
        content: `<@${member.id}> Welcome! Click below to get started:`,
        components: [row]
      });
    }
  }
});


// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {

    // 🔘 OPEN FORM
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

      let role = interaction.guild.roles.cache.find(r =>
        isSameCompany(r.name, company)
      );

      let category = interaction.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildCategory &&
        isSameCompany(c.name, company)
      );

      try {
        await member.setNickname(`${name} | ${company}`);
      } catch {}

      if (role && category) {

        await member.roles.add(role);

        await interaction.editReply({
          content: `Welcome ${name} from ${company} 🎉`
        });

      } else {

        const pendingRole = interaction.guild.roles.cache.find(r => r.name === "Pending");
        if (pendingRole) await member.roles.add(pendingRole);

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
          content: `Thanks! We’re setting things up for you ⏳`
        });
      }
    }

    // =========================
    // ✅ APPROVE
    // =========================
    if (interaction.isButton() && interaction.customId.startsWith("approve_")) {

      await interaction.deferReply({ ephemeral: true });

      const parts = interaction.customId.split('_');
      const userId = parts[1];
      const company = parts.slice(2).join('_');

      const member = await interaction.guild.members.fetch(userId);

      let role = interaction.guild.roles.cache.find(r =>
        isSameCompany(r.name, company)
      );

      if (!role) {
        role = await interaction.guild.roles.create({ name: company });
      }

      const pendingRole = interaction.guild.roles.cache.find(r => r.name === "Pending");
      if (pendingRole) await member.roles.remove(pendingRole);

      await member.roles.add(role);

      const permissionOverwrites = [
        {
          id: interaction.guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: role.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak
          ]
        }
      ];

      let category = interaction.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildCategory &&
        isSameCompany(c.name, company)
      );

      if (!category) {
        category = await interaction.guild.channels.create({
          name: company,
          type: ChannelType.GuildCategory,
          permissionOverwrites
        });

        await interaction.guild.channels.create({
          name: 'general',
          type: ChannelType.GuildText,
          parent: category.id
        });

        try {
          await interaction.guild.channels.create({
            name: 'Voice Call',
            type: ChannelType.GuildVoice,
            parent: category.id,
            permissionOverwrites
          });
        } catch (err) {
          console.log("Voice error:", err.message);
        }
      }

      // 🔥 HIDE WELCOME CHANNEL FROM THIS ROLE
      const welcomeChannel = interaction.guild.channels.cache.find(c => c.name === "welcome");

      if (welcomeChannel) {
        try {
          await welcomeChannel.permissionOverwrites.edit(role.id, {
            ViewChannel: false
          });
        } catch {}
      }

      await interaction.message.delete().catch(() => {});

      await interaction.editReply({
        content: `✅ Approved ${member.user.username}`
      });
    }

    // =========================
    // ❌ REJECT
    // =========================
    if (interaction.isButton() && interaction.customId.startsWith("reject_")) {

      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.customId.split('_')[1];
      const member = await interaction.guild.members.fetch(userId);

      const pendingRole = interaction.guild.roles.cache.find(r => r.name === "Pending");
      if (pendingRole) await member.roles.remove(pendingRole);

      await interaction.message.delete().catch(() => {});

      await interaction.editReply({
        content: `❌ Rejected ${member.user.username}`
      });
    }

  } catch (error) {
    console.error("ERROR:", error);
  }
});

client.login(process.env.TOKEN);
