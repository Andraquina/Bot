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

// =========================
// READY & COMMAND REGISTRATION
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 IMI SYSTEM ONLINE');

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-broadcast')
      .setDescription('Create broadcast panel'),
    new SlashCommandBuilder()
      .setName('create-production')
      .setDescription('Create a private production channel for a company')
      .addRoleOption(option => 
        option.setName('role').setDescription('Select the Company Role').setRequired(true))
      .addStringOption(option => 
        option.setName('name').setDescription('Name of the Mold/Production').setRequired(true))
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commands Registered Successfully");
  } catch (error) { console.error("Command Registration Error:", error); }
});

// =========================
// 🧠 HELPERS
// =========================
function normalize(str) { return str.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function formatWords(str) {
  if (!str) return "";
  return str.toLowerCase().split(/\s+/).filter(w => w.length > 0).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function getAcronym(company) {
  const words = company.split(/\s+/);
  if (words.length === 1) return company.substring(0, 3).toUpperCase();
  return words.map(w => w[0].toUpperCase()).join('');
}
function isSameCompany(a, b) { return normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a)); }

async function buildDropdown(guild, selected = []) {
  await guild.roles.fetch();
  const roles = guild.roles.cache.filter(r => r.name !== "@everyone" && !r.managed).map(r => r.name).slice(0, 25);
  return new StringSelectMenuBuilder().setCustomId("select_companies").setPlaceholder("Select companies").setMinValues(1).setMaxValues(Math.min(roles.length + 1, 25))
    .addOptions([{ label: "ALL", value: "all", default: selected.includes("all") }, ...roles.map(r => ({ label: r, value: r, default: selected.includes(r) }))]);
}

// =========================
// 👋 JOIN SYSTEM & 5-MIN KICK
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_onboarding_modal').setLabel('Start Setup').setStyle(ButtonStyle.Primary));
  const msg = await channel.send({ content: `<@${member.id}> Welcome! Click below to start. You have **5 minutes** to submit your info before the session expires.`, components: [row] });

  onboardingData.set(member.id, { welcomeMsgId: msg.id, welcomeChannelId: channel.id, status: 'idle' });

  setTimeout(async () => {
    const data = onboardingData.get(member.id);
    if (data && data.status === 'idle') {
      try {
        const welcomeChannel = member.guild.channels.cache.get(data.welcomeChannelId);
        if (welcomeChannel) {
          const m = await welcomeChannel.messages.fetch(data.welcomeMsgId).catch(() => null);
          if (m) await m.delete().catch(() => {});
        }
        await member.send("⚠️ Your setup session has expired. Please re-enter through the invite link.").catch(() => {});
        await member.kick("Onboarding idle timeout (5 minutes)").catch(() => {});
      } catch (e) { console.log("Timer Error:", e); } finally { onboardingData.delete(member.id); }
    }
  }, 5 * 60 * 1000);
});

// =========================
// 📋 INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    // 1. SLASH COMMANDS
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup-broadcast") {
        const btn = new ButtonBuilder().setCustomId("start_broadcast").setLabel("📢 Start Broadcast").setStyle(ButtonStyle.Primary);
        await interaction.channel.send({ content: "📢 **Broadcast Panel**", components: [new ActionRowBuilder().addComponents(btn)] });
        return interaction.reply({ content: "✅ Panel created.", ephemeral: true });
      }

      if (interaction.commandName === "create-production") {
        const role = interaction.options.getRole('role');
        const moldName = interaction.options.getString('name');

        const category = interaction.guild.channels.cache.find(c => c.name === role.name && c.type === ChannelType.GuildCategory);
        if (!category) return interaction.reply({ content: `❌ No category found for **${role.name}**.`, ephemeral: true });

        const basicPerms = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];
        
        const newChan = await interaction.guild.channels.create({
          name: moldName,
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: role.id, allow: basicPerms, deny: [PermissionsBitField.Flags.MentionEveryone, PermissionsBitField.Flags.ManageMessages] }
          ]
        });

        await newChan.send(`🏗️ **Production Channel Created**\nWelcome to the tracking channel for **${moldName}**. This channel is private to your company.`);
        return interaction.reply({ content: `✅ Created <#${newChan.id}> under **${role.name}**.`, ephemeral: true });
      }
    }

    // 2. MODAL SUBMISSIONS
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        const data = session.get(interaction.user.id);
        if (!data) return;
        const text = interaction.fields.getTextInputValue("message");
        const members = await interaction.guild.members.fetch();
        const targetMembers = members.filter(m => !m.user.bot && (data.targets.includes("all") || m.roles.cache.some(r => data.targets.some(t => isSameCompany(r.name, t)))));
        const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("back").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger));
        await data.message.edit({ content: `📢 **Preview**\n🎯 Targets: ${data.targets.join(", ")}\n👥 Users: ${targetMembers.size}\n\nMessage: ${text}`, components: [buttons] });
        session.set(interaction.user.id, { ...data, messageContent: text, targetMembers });
        return;
      }

      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');
        const currentData = onboardingData.get(interaction.user.id) || {};
        onboardingData.set(interaction.user.id, { ...currentData, name, company, status: 'submitted' });

        const adminChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("admin") && c.type === ChannelType.GuildText);
        if (!adminChannel) return interaction.reply({ content: "❌ Admin channel not found.", ephemeral: true });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger));
        await adminChannel.send({ content: `🚨 New request\nUser: <@${interaction.user.id}>\nName: ${name}\nCompany: ${company}`, components: [row] });
        
        if (currentData.welcomeMsgId) {
          const welcomeChannel = interaction.guild.channels.cache.get(currentData.welcomeChannelId);
          if (welcomeChannel) welcomeChannel.messages.fetch(currentData.welcomeMsgId).then(m => m.delete().catch(() => {}));
        }
        return interaction.reply({ content: "✅ Info submitted. Please wait for approval.", ephemeral: true });
      }
    }

    // 3. SELECT MENUS
    if (interaction.isStringSelectMenu() && interaction.customId === "select_companies") {
      const data = session.get(interaction.user.id) || {};
      session.set(interaction.user.id, { ...data, targets: interaction.values });
      const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Broadcast Message");
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("delay").setLabel("Delay").setStyle(TextInputStyle.Short).setRequired(false)));
      return interaction.showModal(modal);
    }

    // 4. BUTTONS
    if (interaction.isButton()) {
      const data = session.get(interaction.user.id);

      if (interaction.customId === "start_broadcast") {
        const dropdown = await buildDropdown(interaction.guild);
        const msg = await interaction.reply({ content: "🎯 Select targets:", components: [new ActionRowBuilder().addComponents(dropdown)], fetchReply: true });
        session.set(interaction.user.id, { message: msg });
        return;
      }

      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder().setCustomId('onboarding_modal').setTitle('Setup');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Company').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (data) {
        if (interaction.customId === "confirm") {
          const { targetMembers, messageContent, message, targets } = data;
          await interaction.update({ content: `🚀 Sending...`, components: [] });
          let success = 0;
          for (const m of targetMembers.values()) {
            try { await m.send({ embeds: [new EmbedBuilder().setColor(targets.includes("all") ? 0x2ecc71 : 0x3498db).setTitle("📢 Announcement").setDescription(messageContent).setFooter({ text: "Inter Molds, Inc." }).setTimestamp()] }); success++; } catch {}
          }
          await interaction.channel.send({ content: `✅ **Broadcast Completed**\n🎯 Targets: ${targets.join(", ")}\n👤 Sent: ${success}\n💬 ${messageContent}` });
          await message.delete().catch(() => {});
          session.delete(interaction.user.id);
          return;
        }
        if (interaction.customId === "back") {
          const dropdown = await buildDropdown(interaction.guild, data.targets);
          const msg = await interaction.update({ content: "🎯 Select targets:", components: [new ActionRowBuilder().addComponents(dropdown)], fetchReply: true });
          session.set(interaction.user.id, { ...data, message: msg });
          return;
        }
        if (interaction.customId === "cancel") {
          session.delete(interaction.user.id);
          return interaction.update({ content: "❌ Cancelled.", components: [] });
        }
      }

      // APPROVAL SYSTEM (Nuclear Wipe)
      if (interaction.customId.startsWith("approve_")) {
        const userId = interaction.customId.split("_")[1];
        const onboard = onboardingData.get(userId);
        if (!onboard) return;
        await interaction.reply({ content: "⏳ Finalizing...", ephemeral: true });
        const member = await interaction.guild.members.fetch(userId);
        const name = formatWords(onboard.name);
        const company = formatWords(onboard.company);
        
        let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, company)) || await interaction.guild.roles.create({ name: company });
        await member.roles.add(role);
        await member.setNickname(`${name} | ${getAcronym(company)}`);
        
        let category = interaction.guild.channels.cache.find(c => c.name === company && c.type === ChannelType.GuildCategory);
        if (!category) {
          category = await interaction.guild.channels.create({ name: company, type: ChannelType.GuildCategory, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }] });
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

        const rules = new EmbedBuilder()
          .setTitle("📜 Inter Molds | Server Guidelines")
          .setColor(0xF1C40F)
          .setDescription("**1. Account Setup:** Use company email & Desktop App.\n**2. Privacy:** Your company category is strictly private.\n**3. Production:** Use dedicated mold channels for tracking.\n**4. Team Members:** Colleagues must use the same Company Name to merge.\n**5. Help:** Direct Message an Admin for urgent matters.")
          .setFooter({ text: "Inter Molds, Inc." });

        await member.send({ embeds: [rules] }).catch(() => {});
        await interaction.channel.send({ content: `✅ Approved **${name}** from **${company}**` });
        onboardingData.delete(userId);
        await interaction.deleteReply().catch(() => {});
        await interaction.message.delete().catch(() => {});
      }
      
      if (interaction.customId.startsWith("deny_")) {
        const userId = interaction.customId.split("_")[1];
        onboardingData.delete(userId);
        await interaction.message.delete().catch(() => {});
      }
    }
  } catch (err) { console.error("Interaction Error:", err); }
});

// =========================
// ✉️ DM REDIRECTION
// =========================
client.on(Events.MessageCreate, async msg => {
  if (msg.guild || msg.author.bot) return;
  if (repliedUsers.has(msg.author.id)) return;
  repliedUsers.add(msg.author.id);

  const dmEmbed = new EmbedBuilder()
    .setColor(0x2F3136)
    .setAuthor({ name: 'IMI | Inter Molds System', iconURL: client.user.displayAvatarURL() })
    .setTitle("✉️ Inter Molds System")
    .setDescription("This bot is for notifications only.\nWe do not monitor messages sent here.\n\nContact an admin directly for assistance.")
    .setFooter({ text: "Official System Notification" })
    .setTimestamp();

  await msg.reply({ embeds: [dmEmbed] });
});

client.login(process.env.TOKEN);
