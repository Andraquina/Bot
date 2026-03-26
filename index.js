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
// STATE MANAGEMENT
// =========================
const session = new Map();
const repliedUsers = new Set();
const onboardingData = new Map();
const processingUsers = new Set();
const guildMemberCache = new Map();

// =========================
// READY & SLASH COMMANDS
// =========================
client.once(Events.ClientReady, async () => {
  console.log('🔥 IMI SYSTEM ONLINE - VERSION 4.1');

  const commands = [
    new SlashCommandBuilder()
      .setName('setup-broadcast')
      .setDescription('Create broadcast panel'),
    new SlashCommandBuilder()
      .setName('create-production')
      .setDescription('Create the permanent Production Channel button')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commands registered successfully");
  } catch (error) {
    console.error("Command registration error:", error);
  }
});

// =========================
// 🧠 HELPER FUNCTIONS
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

async function buildDropdown(guild, selected = [], customId = "select_companies") {
  await guild.roles.fetch();
  const roles = guild.roles.cache
    .filter(r => r.name !== "@everyone" && !r.managed)
    .map(r => r.name)
    .slice(0, 25);
    
  const dropdown = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select company role")
    .setMinValues(1)
    .setMaxValues(customId === "prod_select" ? 1 : Math.min(roles.length + 1, 25));

  const options = [];
  if (customId !== "prod_select") {
    options.push({ label: "ALL", value: "all", default: selected.includes("all") });
  }
  
  roles.forEach(roleName => {
    options.push({ label: roleName, value: roleName, default: selected.includes(roleName) });
  });

  dropdown.addOptions(options);
  return dropdown;
}

// =========================
// 👋 ONBOARDING & 5-MIN TIMER
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c => c.name.toLowerCase().includes("welcome"));
  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('open_onboarding_modal').setLabel('Start Setup').setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({
    content: `<@${member.id}> Welcome to Inter Molds! Click below to start your setup. You have **5 minutes**.`,
    components: [row]
  });

  onboardingData.set(member.id, {
    welcomeMsgId: msg.id,
    welcomeChannelId: channel.id,
    status: 'idle' 
  });

  setTimeout(async () => {
    const data = onboardingData.get(member.id);
    if (data && data.status === 'idle') {
      try {
        const welcomeChannel = member.guild.channels.cache.get(data.welcomeChannelId);
        if (welcomeChannel) {
          const m = await welcomeChannel.messages.fetch(data.welcomeMsgId).catch(() => null);
          if (m) await m.delete().catch(() => {});
        }
        await member.kick("Onboarding timeout").catch(() => {});
      } catch (e) {
        console.log("Timer cleanup error:", e);
      } finally {
        onboardingData.delete(member.id);
      }
    }
  }, 5 * 60 * 1000);
});

// =========================
// 📋 INTERACTION HANDLER
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "setup-broadcast") {
        const button = new ButtonBuilder().setCustomId("start_broadcast").setLabel("📢 Start Broadcast").setStyle(ButtonStyle.Primary);
        await interaction.channel.send({
          content: "📢 **Broadcast Panel**\nClick below to start:",
          components: [new ActionRowBuilder().addComponents(button)]
        });
        return interaction.reply({ content: "✅ Panel created.", ephemeral: true });
      }

      if (interaction.commandName === "create-production") {
        const btn = new ButtonBuilder().setCustomId("start_production").setLabel("🏗️ Create Production").setStyle(ButtonStyle.Success);
        await interaction.channel.send({
          content: "🏗️ **Production Management**\nClick below to create a new channel:",
          components: [new ActionRowBuilder().addComponents(btn)]
        });
        return interaction.reply({ content: "✅ Production tool created.", ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      const data = session.get(interaction.user.id);

      if (interaction.customId === "broadcast_modal") {
        await interaction.deferUpdate();
        if (!data) return;

        const messageContent = interaction.fields.getTextInputValue("message");
        const delayValue = interaction.fields.getTextInputValue("delay") || "0";
        const targets = data.targets;
        
        let members = await interaction.guild.members.fetch();
        const targetMembers = members.filter(m => !m.user.bot && (targets.includes("all") || m.roles.cache.some(r => targets.some(t => isSameCompany(r.name, t)))));
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm_bc").setLabel("Confirm & Send").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("back_bc").setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("cancel_flow").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );

        await data.message.edit({
          content: `📢 **Broadcast Preview**\n\n🎯 Targets: ${targets.join(", ")}\n👥 Users: ${targetMembers.size}\n⏳ Delay: ${delayValue}s\n\n💬 Message: ${messageContent}`,
          components: [row]
        });

        session.set(interaction.user.id, { ...data, messageContent, targetMembers, delay: delayValue });
      }

      if (interaction.customId === "production_modal") {
        await interaction.deferUpdate();
        if (!data) return;

        const moldName = interaction.fields.getTextInputValue("mold_name");
        const roleName = data.targets[0];
        
        const previewRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm_prod").setLabel("Confirm Creation").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("cancel_flow").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        );

        await data.message.edit({
          content: `🏗️ **Production Preview**\n\n🏢 **Company:** ${roleName}\n🆔 **Mold Name:** ${moldName}`,
          components: [previewRow]
        });

        session.set(interaction.user.id, { ...data, moldName });
      }

      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');
        const currentData = onboardingData.get(interaction.user.id) || {};
        onboardingData.set(interaction.user.id, { ...currentData, name, company, status: 'submitted' });
        const adminChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes("admin"));
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );
        await adminChannel.send({ content: `🚨 New request\nUser: <@${interaction.user.id}>\nName: ${name}\nCompany: ${company}`, components: [row] });
        if (currentData.welcomeMsgId) {
          const welcomeChannel = interaction.guild.channels.cache.get(currentData.welcomeChannelId);
          if (welcomeChannel) welcomeChannel.messages.fetch(currentData.welcomeMsgId).then(m => m.delete().catch(() => {}));
        }
        return interaction.reply({ content: "✅ Info submitted.", ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      const data = session.get(interaction.user.id);
      
      if (interaction.customId === "start_broadcast") {
        await interaction.deferUpdate();
        const dropdown = await buildDropdown(interaction.guild);
        const msg = await interaction.channel.send({
          content: "🎯 Select target companies for the Broadcast:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
        session.set(interaction.user.id, { message: msg });
        return;
      }

      if (interaction.customId === "start_production") {
        await interaction.deferUpdate();
        const dropdown = await buildDropdown(interaction.guild, [], "prod_select");
        const msg = await interaction.channel.send({
          content: "🏗️ **Production Setup**\nSelect the company category:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
        session.set(interaction.user.id, { message: msg });
        return;
      }

      if (interaction.customId === "confirm_bc" && data) {
        const delayMs = (parseInt(data.delay) || 0) * 1000;
        await interaction.update({ content: `🚀 Sending broadcast...`, components: [] });
        let success = 0;
        for (const member of data.targetMembers.values()) {
          try {
            await member.send({
              embeds: [new EmbedBuilder().setColor(0x3498db).setTitle("📢 Announcement").setDescription(data.messageContent).setFooter({ text: "Inter Molds, Inc." }).setTimestamp()]
            });
            success++;
            if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
          } catch {}
        }
        await interaction.channel.send({ content: `✅ **Broadcast Completed**\n\n🎯 Targets: ${data.targets.join(", ")}\n👤 Sent: ${success}\n💬 Message: ${data.messageContent}` });
        await data.message.delete().catch(() => {});
        session.delete(interaction.user.id);
        return;
      }

      if (interaction.customId === "confirm_prod" && data) {
        await interaction.update({ content: `🏗️ Creating channel...`, components: [] });
        const role = interaction.guild.roles.cache.find(r => r.name === data.targets[0]);
        const category = interaction.guild.channels.cache.find(c => c.name === role.name && c.type === ChannelType.GuildCategory);
        const basicPerms = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AddReactions, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];
        const newChan = await interaction.guild.channels.create({
          name: data.moldName, type: ChannelType.GuildText, parent: category.id,
          permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: role.id, allow: basicPerms, deny: [PermissionsBitField.Flags.MentionEveryone, PermissionsBitField.Flags.ManageMessages] }]
        });
        await interaction.channel.send({ content: `✅ **Production Created**\n\n🏢 **Company:** ${role.name}\n🆔 **Mold ID:** ${data.moldName}\n📂 **Channel:** <#${newChan.id}>` });
        await data.message.edit({ components: [] }).catch(() => {});
        await data.message.delete().catch(() => {});
        session.delete(interaction.user.id);
        return;
      }

      if (interaction.customId === "back_bc" && data) {
        const dropdown = await buildDropdown(interaction.guild, data.targets);
        return interaction.update({ content: "🎯 Select target companies:", components: [new ActionRowBuilder().addComponents(dropdown)] });
      }

      if (interaction.customId === "cancel_flow" && data) {
        if (data.message) await data.message.delete().catch(() => {});
        session.delete(interaction.user.id);
        return interaction.reply({ content: "❌ Session Cancelled.", ephemeral: true });
      }

      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder().setCustomId('onboarding_modal').setTitle('Setup');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('company_name').setLabel('Company').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("approve_")) {
        const userId = interaction.customId.split("_")[1];
        const onboard = onboardingData.get(userId);
        if (!onboard) return;
        await interaction.reply({ content: "⏳ Processing...", ephemeral: true });
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
        const rules = new EmbedBuilder().setTitle("📜 Inter Molds | Guidelines").setColor(0xF1C40F).setDescription("**1. Account Setup:** Use company email.\n**2. Privacy:** Category is private.\n**3. Production:** Use dedicated mold channels.\n**4. Growth:** Same Company Name to merge.\n**5. Help:** DM Admin.");
        await member.send({ embeds: [rules] }).catch(() => {});
        await interaction.channel.send({ content: `✅ Approved **${name}** from **${company}**` });
        onboardingData.delete(userId);
        await interaction.deleteReply().catch(() => {});
        await interaction.message.delete().catch(() => {});
      }
    }

    if (interaction.isStringSelectMenu()) {
      // 🚨 CRITICAL FIX: Explicitly handle modal opening for select menus
      if (interaction.customId === "select_companies" || interaction.customId === "prod_select") {
        const data = session.get(interaction.user.id) || {};
        session.set(interaction.user.id, { ...data, targets: interaction.values });

        if (interaction.customId === "select_companies") {
          const modal = new ModalBuilder().setCustomId("broadcast_modal").setTitle("Broadcast Message");
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("delay").setLabel("Delay (seconds)").setStyle(TextInputStyle.Short).setPlaceholder("0").setRequired(false))
          );
          return interaction.showModal(modal);
        } else {
          const modal = new ModalBuilder().setCustomId("production_modal").setTitle("Mold Details");
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("mold_name").setLabel("Mold Name").setStyle(TextInputStyle.Short).setRequired(true))
          );
          return interaction.showModal(modal);
        }
      }
    }
  } catch (err) { console.error("Error:", err); }
});

// DM Redirection
client.on(Events.MessageCreate, async msg => {
  if (msg.guild || msg.author.bot) return;
  if (repliedUsers.has(msg.author.id)) return;
  repliedUsers.add(msg.author.id);
  const dmEmbed = new EmbedBuilder().setColor(0x2F3136).setAuthor({ name: 'IMI | Inter Molds System', iconURL: client.user.displayAvatarURL() }).setTitle("✉️ Inter Molds System").setDescription("Notifications only. DM Admin.").setFooter({ text: "Official System" }).setTimestamp();
  await msg.reply({ embeds: [dmEmbed] });
});

client.login(process.env.TOKEN);
