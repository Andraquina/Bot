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
// 🧠 HELPERS
// =========================

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractKeywords(str) {
  return str.toLowerCase().split(/\s+/);
}

function formatWords(str) {
  return str
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getAcronym(company) {
  const words = company.toLowerCase().split(/\s+/);
  if (words.length === 1) return company;
  return words.map(w => w[0].toUpperCase()).join('');
}

function isSameCompany(a, b) {
  const na = normalize(a);
  const nb = normalize(b);

  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const acA = getAcronym(a).toLowerCase();
  const acB = getAcronym(b).toLowerCase();

  if (acA === nb || acB === na) return true;

  const wordsA = extractKeywords(a);
  const wordsB = extractKeywords(b);

  const common = wordsA.filter(w => wordsB.includes(w));
  return common.length >= Math.min(wordsA.length, wordsB.length) / 2;
}

function safeCompanyId(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}


// =========================
// 👋 ON USER JOIN
// =========================
client.on(Events.GuildMemberAdd, async member => {

  const channel = member.guild.channels.cache.find(c => c.name === "welcome");
  if (!channel) return;

  const button = new ButtonBuilder()
    .setCustomId('open_form')
    .setLabel('Start Setup')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  await channel.send({
    content: `<@${member.id}> Welcome! Click below to get started:`,
    components: [row]
  });
});


// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {

    if (interaction.isButton() && interaction.customId === 'open_form') {

      try { await interaction.message.delete(); } catch {}

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

    if (interaction.isModalSubmit() && interaction.customId === 'user_form') {

      await interaction.deferReply({ ephemeral: true });

      let name = formatWords(interaction.fields.getTextInputValue('name'));
      let company = formatWords(interaction.fields.getTextInputValue('company'));

      const member = await interaction.guild.members.fetch(interaction.user.id);

      const companyShort = getAcronym(company);

      let role = interaction.guild.roles.cache.find(r =>
        isSameCompany(r.name, company)
      );

      let category = interaction.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildCategory &&
        isSameCompany(c.name, company)
      );

      try {
        let nickname = `${name} | ${companyShort}`;
        if (nickname.length > 32) nickname = nickname.slice(0, 32);
        await member.setNickname(nickname);
      } catch {}

      if (role && category) {

        await member.roles.add(role);

        await interaction.editReply({
          content: `Welcome ${name} from ${company} 🎉`
        });

      } else {

        const pendingRole = interaction.guild.roles.cache.find(r => r.name === "Pending");
        if (pendingRole) await member.roles.add(pendingRole);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`approve_${member.id}_${safeCompanyId(company)}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`reject_${member.id}_${safeCompanyId(company)}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger)
        );

        const adminChannel = interaction.guild.channels.cache.find(c => c.name === "admin");

        if (adminChannel) {
          await adminChannel.send({
            content: `🚨 New company request\n\nUser: <@${member.id}>\nCompany: ${company}`,
            components: [row]
          });
        }

        await interaction.editReply({
          content: `Thanks! We’re setting things up for you ⏳`
        });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith("approve_")) {

      await interaction.deferReply({ ephemeral: true });

      const [_, userId, companyId] = interaction.customId.split('_');

      const member = await interaction.guild.members.fetch(userId);

      let role = interaction.guild.roles.cache.find(r =>
        isSameCompany(r.name, companyId)
      );

      let company = role ? role.name : formatWords(companyId);

      if (!role) {
        role = await interaction.guild.roles.create({ name: company });
      }

      const pendingRole = interaction.guild.roles.cache.find(r => r.name === "Pending");
      if (pendingRole) await member.roles.remove(pendingRole);

      await member.roles.add(role);

      // 🔥 ANNOUNCEMENTS + RULES ACCESS
      for (const ch of interaction.guild.channels.cache.values()) {
        if (
          ch.name.toLowerCase().includes("announcement") ||
          ch.name.toLowerCase().includes("rule")
        ) {
          await ch.permissionOverwrites.edit(role.id, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: false,
            AddReactions: false
          });
        }
      }

      let category = interaction.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildCategory &&
        isSameCompany(c.name, company)
      );

      if (!category) {
        category = await interaction.guild.channels.create({
          name: company,
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
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
          ]
        });

        await interaction.guild.channels.create({
          name: 'general',
          type: ChannelType.GuildText,
          parent: category.id
        });

        await interaction.guild.channels.create({
          name: 'Voice Call',
          type: ChannelType.GuildVoice,
          parent: category.id
        });
      }

      const welcomeChannel = interaction.guild.channels.cache.find(c => c.name === "welcome");
      if (welcomeChannel) {
        await welcomeChannel.permissionOverwrites.edit(role.id, { ViewChannel: false });
      }

      try {
        await member.send(`✅ You’ve been approved! Welcome to **Inter Molds, Inc.** 🎉`);
      } catch {}

      await interaction.message.delete().catch(() => {});
      await interaction.editReply({ content: `✅ Approved ${member.user.username}` });
    }

  } catch (error) {
    console.error("ERROR:", error);
  }
});


// =========================
// 🚀 ULTIMATE BROADCAST SYSTEM (EMBED + PREVIEW + CONFIRM)
// =========================
const { EmbedBuilder } = require('discord.js');

client.on(Events.MessageCreate, async message => {

  if (message.author.bot) return;
  if (message.channel.name !== "broadcast") return;

  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply("❌ Not allowed.");
  }

  const content = message.content.trim();

  if (!content.startsWith("!")) {
    return message.reply("❌ Use:\n`!company1;company2 ! message`");
  }

  const parts = content.split("!").map(p => p.trim()).filter(p => p);

  if (parts.length < 2) {
    return message.reply("❌ Correct format:\n`!targets ! message`");
  }

  const targets = parts[0].toLowerCase().split(";").map(t => t.trim());
  const messageContent = parts.slice(1).join(" ! ");

  const members = await message.guild.members.fetch();

  const targetMembers = [];

  for (const member of members.values()) {

    if (member.user.bot) continue;

    if (targets.includes("all")) {
      targetMembers.push(member);
      continue;
    }

    const match = member.roles.cache.some(role =>
      targets.some(t => isSameCompany(role.name, t))
    );

    if (match) targetMembers.push(member);
  }

  if (targetMembers.length === 0) {
    return message.reply("❌ No users found for those targets.");
  }

  // =========================
  // 🔍 PREVIEW
  // =========================
  const confirmBtn = new ButtonBuilder()
    .setCustomId('confirm_broadcast')
    .setLabel('Confirm')
    .setStyle(ButtonStyle.Success);

  const cancelBtn = new ButtonBuilder()
    .setCustomId('cancel_broadcast')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

  const previewMsg = await message.reply({
    content:
      `📢 **Broadcast Preview**\n\n` +
      `🎯 Targets: ${targets.join(", ")}\n` +
      `👥 Users: ${targetMembers.length}\n\n` +
      `💬 Message:\n${messageContent}`,
    components: [row]
  });

  // =========================
  // 🔘 BUTTON HANDLER
  // =========================
  const filter = i =>
    (i.customId === 'confirm_broadcast' || i.customId === 'cancel_broadcast') &&
    i.user.id === message.author.id;

  const collector = previewMsg.createMessageComponentCollector({
    filter,
    time: 30000
  });

  collector.on('collect', async interaction => {

    if (interaction.customId === 'cancel_broadcast') {
      await interaction.update({
        content: "❌ Broadcast cancelled.",
        components: []
      });
      collector.stop();
      return;
    }

    if (interaction.customId === 'confirm_broadcast') {

      let success = 0;
      let failed = 0;

      for (const member of targetMembers) {
        try {

          // 🎨 EMBED MESSAGE
          const embed = new EmbedBuilder()
            .setColor(targets.includes("all") ? 0x2ecc71 : 0x3498db) // green = global, blue = company
            .setTitle(targets.includes("all") ? "📢 Announcement" : "📢 Company Update")
            .setDescription(messageContent)
            .setFooter({
              text: "Inter Molds, Inc.",
              iconURL: "https://image.pitchbook.com/bCxcu5izk9sdndXf787YWVFTzmb1703134045865_200x200" // 🔥 replace with your logo if you want
            })
            .setTimestamp();

          await member.send({ embeds: [embed] });

          success++;

        } catch {
          failed++;
        }
      }

      await interaction.update({
        content: `✅ Sent: ${success} | ❌ Failed: ${failed}`,
        components: []
      });

      collector.stop();
    }
  });

  collector.on('end', async collected => {
    if (collected.size === 0) {
      await previewMsg.edit({
        content: "⏳ Broadcast expired.",
        components: []
      });
    }
  });
});

client.login(process.env.TOKEN);
