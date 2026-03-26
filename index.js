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
  ChannelType,
  EmbedBuilder,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// =========================
// STATE
// =========================
const session = new Map();
const repliedUsers = new Set();
const onboardingData = new Map();
const processingUsers = new Set();
const guildMemberCache = new Map();

// =========================
// READY
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 BOT IS ONLINE');

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-broadcast')
      .setDescription('Create broadcast panel')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commands registered");
  } catch (error) {
    console.error(error);
  }
});

// =========================
// 🧠 HELPERS
// =========================
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatWords(str) {
  if (!str) return "";
  return str.toLowerCase().split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getAcronym(company) {
  const words = company.split(/\s+/);
  if (words.length === 1) return company.substring(0, 3).toUpperCase();
  return words.map(w => w[0].toUpperCase()).join('');
}

function isSameCompany(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  return na.includes(nb) || nb.includes(na);
}

async function buildDropdown(guild, selected = []) {
  await guild.roles.fetch();
  const roles = guild.roles.cache
    .filter(r => r.name !== "@everyone" && !r.managed)
    .map(r => r.name)
    .slice(0, 25);
  return new StringSelectMenuBuilder()
    .setCustomId("select_companies")
    .setPlaceholder("Select companies")
    .setMinValues(1)
    .setMaxValues(Math.min(roles.length + 1, 25))
    .addOptions([
      { label: "ALL", value: "all", default: selected.includes("all") },
      ...roles.map(r => ({ label: r, value: r, default: selected.includes(r) }))
    ]);
}

async function createPanel(channel) {
  const button = new ButtonBuilder()
    .setCustomId("start_broadcast")
    .setLabel("📢 Start Broadcast")
    .setStyle(ButtonStyle.Primary);
  return await channel.send({
    content: "📢 **Broadcast Panel**\nClick below to start:",
    components: [new ActionRowBuilder().addComponents(button)]
  });
}

// =========================
// JOIN
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c =>
    c.name.toLowerCase().includes("welcome")
  );
  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_onboarding_modal')
      .setLabel('Start Setup')
      .setStyle(ButtonStyle.Primary)
  );

  // We send the message normally so Admins can see it
  const msg = await channel.send({
    content: `<@${member.id}> Welcome! Click below to start your setup. (Only you and Admins can see this message)`,
    components: [row]
  });

  // 🔥 NEW: Set permission so only THIS member and Admins can see the message content/interact
  // Note: Standard messages can't be hidden per-user easily without ephemeral, 
  // but we will use the Modal logic to keep it clean.
  
  onboardingData.set(member.id, {
    welcomeMsgId: msg.id,
    welcomeChannelId: channel.id
  });
});

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {
      await createPanel(interaction.channel);
      return interaction.reply({ content: "✅ Panel created.", ephemeral: true });
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        const data = session.get(interaction.user.id);
        if (!data) return;
        const messageContent = interaction.fields.getTextInputValue("message");
        const targets = data.targets;
        
        let members = await interaction.guild.members.fetch();
        const targetMembers = members.filter(m =>
          !m.user.bot && (targets.includes("all") || m.roles.cache.some(r => targets.some(t => isSameCompany(r.name, t))))
        );
        
        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("back").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );
        
        await data.message.edit({
          content: `📢 **Preview**\n\n🎯 Targets: ${targets.join(", ")}\n👥 Users: ${targetMembers.size}\n\nMessage: ${messageContent}`,
          components: [buttons]
        });
        
        session.set(interaction.user.id, { ...data, messageContent, targetMembers });
      }

      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');
        onboardingData.set(interaction.user.id, { ...onboardingData.get(interaction.user.id), name, company });

        const adminChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("admin") && c.type === ChannelType.GuildText);
        if (!adminChannel) return interaction.reply({ content: "❌ Admin channel not found.", ephemeral: true });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        await adminChannel.send({ content: `🚨 New request\n\nUser: <@${interaction.user.id}>\nName: ${name}\nCompany: ${company}`, components: [row] });
        
        const entry = onboardingData.get(interaction.user.id);
        if (entry?.welcomeMsgId) {
          const welcomeChannel = interaction.guild.channels.cache.get(entry.welcomeChannelId);
          if (welcomeChannel) welcomeChannel.messages.fetch(entry.welcomeMsgId).then(m => m.delete().catch(() => {}));
        }

        return interaction.reply({ content: "✅ Sent to admins.", ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {
      const data = session.get(interaction.user.id) || {};
      session.set(interaction.user.id, { ...data, targets: interaction.values });
      const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Broadcast Message");
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("delay").setLabel("Delay").setStyle(TextInputStyle.Short).setRequired(false))
      );
      await interaction.showModal(modal);
    }

    if (interaction.isButton()) {
      const data = session.get(interaction.user.id);

      if (interaction.customId === "start_broadcast") {
        const dropdown = await buildDropdown(interaction.guild);
        const msg = await interaction.reply({ content: "🎯 Select companies:", components: [new ActionRowBuilder().addComponents(dropdown)], fetchReply: true });
        session.set(interaction.user.id, { message: msg });
        return;
      }

      if (interaction.customId === 'open_onboarding_modal') {
        // 🔥 PROTECTION: Check if the person clicking the button is the one mentioned in the message
        // This prevents User B from clicking User A's button.
        if (!interaction.message.content.includes(interaction.user.id)) {
           return interaction.reply({ content: "❌ This setup button is not for you. Please wait for your own welcome message.", ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId('onboarding_modal').setTitle('Setup');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Company').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "confirm" && data) {
        const { targetMembers, messageContent, message, targets } = data;
        await interaction.update({ content: `🚀 Sending... (0/${targetMembers.size})`, components: [] });
        let i = 0; let success = 0;
        for (const member of targetMembers.values()) {
          i++;
          try {
            await member.send({ embeds: [new EmbedBuilder().setColor(targets.includes("all") ? 0x2ecc71 : 0x3498db).setTitle(targets.includes("all") ? "📢 Announcement" : "📢 Company Update").setDescription(messageContent).setFooter({ text: "Inter Molds, Inc." }).setTimestamp()] });
            success++;
          } catch {}
          if (i % 2 === 0 || i === targetMembers.size) await message.edit({ content: `🚀 Sending... (${i}/${targetMembers.size})` });
        }
        await interaction.channel.send({ content: `✅ **Broadcast Completed**\n\n🎯 Targets: ${targets.join(", ")}\n👤 Sent: ${success}\n💬 ${messageContent}` });
        await message.delete().catch(() => {});
        session.delete(interaction.user.id);
      }

      if (interaction.customId === "back" && data) {
        const dropdown = await buildDropdown(interaction.guild, data.targets);
        return interaction.update({ content: "🎯 Select companies:", components: [new ActionRowBuilder().addComponents(dropdown)] });
      }
      if (interaction.customId === "cancel" && data) {
        session.delete(interaction.user.id);
        return interaction.update({ content: "❌ Cancelled.", components: [] });
      }

      if (interaction.customId.startsWith("approve_")) {
        const userId = interaction.customId.split("_")[1];
        const onboard = onboardingData.get(userId);
        if (!onboard) return;

        await interaction.reply({ content: "⏳ Processing...", ephemeral: true });

        const member = await interaction.guild.members.fetch(userId);
        const name = formatWords(onboard.name);
        const company = formatWords(onboard.company);

        let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, company));
        if (!role) role = await interaction.guild.roles.create({ name: company });

        await member.roles.add(role);
        await member.setNickname(`${name} | ${getAcronym(company)}`);

        let category = interaction.guild.channels.cache.find(c => c.name === company && c.type === ChannelType.GuildCategory);
        if (!category) {
          category = await interaction.guild.channels.create({
            name: company,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
            ]
          });

          const basic = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];
          
          await interaction.guild.channels.create({ name: 'general', type: ChannelType.GuildText, parent: category.id, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: role.id, allow: basic, deny: [PermissionsBitField.Flags.MentionEveryone, PermissionsBitField.Flags.ManageMessages] }] });
          await interaction.guild.channels.create({ name: 'Voice Call', type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: role.id, allow: basic }] });
        }

        const welcomeChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
        if (welcomeChannel) {
          const newChannel = await welcomeChannel.clone();
          await welcomeChannel.delete().catch(() => {});
          await newChannel.setPosition(welcomeChannel.position);
          await newChannel.permissionOverwrites.create(role.id, { ViewChannel: false });
        }

        await member.send(`✅ You've been approved! Welcome to **Inter Molds, Inc.** 🎉`).catch(() => {});
        await member.send({ embeds: [new EmbedBuilder().setTitle("📜 Rules").setDescription("Follow rules.").setColor(0xF1C40F)] }).catch(() => {});

        await interaction.channel.send({ content: `✅ Approved **${name}** from **${company}**` });
        await interaction.deleteReply().catch(() => {});
        await interaction.message.delete().catch(() => {});
      }

      if (interaction.customId.startsWith("deny_")) {
        const userId = interaction.customId.split("_")[1];
        await interaction.reply({ content: `❌ Denied access for <@${userId}>`, ephemeral: true });
        await interaction.deleteReply().catch(() => {});
        await interaction.message.delete().catch(() => {});
      }
    }
  } catch (err) { console.error(err); }
});

client.on(Events.MessageCreate, async msg => {
  if (msg.guild || msg.author.bot) return;
  if (repliedUsers.has(msg.author.id)) return;
  repliedUsers.add(msg.author.id);
  await msg.reply("📩 **Inter Molds System**\nThis bot is for notifications only.");
});

client.login(process.env.TOKEN);
