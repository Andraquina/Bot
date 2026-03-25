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
    console.error("Registration Error:", error);
  }
});

// =========================
// HELPERS
// =========================
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatTitleCase(str) {
  if (!str) return "";
  return str.toLowerCase().split(/\s+/)
    .filter(w => w.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getAcronym(company) {
  if (!company) return "CO";
  const words = company.trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
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
      ...roles.map(r => ({
        label: r,
        value: r,
        default: selected.includes(r)
      }))
    ]);
}

// =========================
// JOIN SYSTEM
// =========================
client.on(Events.GuildMemberAdd, async member => {
  const channel = member.guild.channels.cache.find(c =>
    c.name.toLowerCase().includes("welcome") &&
    c.type === ChannelType.GuildText
  );

  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_onboarding_modal')
      .setLabel('Start Setup')
      .setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({
    content: `Welcome <@${member.id}>! Click below to register.`,
    components: [row]
  });

  onboardingData.set(member.id, {
    welcomeMsgId: msg.id,
    welcomeChannelId: channel.id
  });
});

// =========================
// INTERACTIONS
// =========================
client.on(Events.InteractionCreate, async interaction => {
  try {

    // =========================
    // BROADCAST PANEL COMMAND
    // =========================
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {
      const button = new ButtonBuilder()
        .setCustomId("start_broadcast")
        .setLabel("📢 Start Broadcast")
        .setStyle(ButtonStyle.Primary);

      await interaction.channel.send({
        content: "📢 **Broadcast Panel**",
        components: [new ActionRowBuilder().addComponents(button)]
      });

      return interaction.reply({ content: "✅ Panel created.", flags: [4096] });
    }

    // =========================
    // BUTTONS
    // =========================
    if (interaction.isButton()) {

      // OPEN MODAL
      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder()
          .setCustomId('onboarding_modal')
          .setTitle('Company Registration');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('user_name')
              .setLabel('Your Full Name')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('company_name')
              .setLabel('Company Name')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

        return await interaction.showModal(modal);
      }

      // APPROVE / DENY
      if (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_')) {
        const [action, userId] = interaction.customId.split('_');
        const data = onboardingData.get(userId);

        if (!data) return interaction.reply({ content: "Error: Session data lost.", flags: [4096] });

        if (action === 'approve') {
          if (processingUsers.has(userId)) return;
          processingUsers.add(userId);

          await interaction.deferUpdate();

          const member = await interaction.guild.members.fetch(userId).catch(() => null);
          if (!member) {
            processingUsers.delete(userId);
            return;
          }

          const cleanName = formatTitleCase(data.name);
          const cleanCompany = formatTitleCase(data.company);
          const acronym = getAcronym(cleanCompany);

          const welcomeChan = data.welcomeChannelId
            ? interaction.guild.channels.cache.get(data.welcomeChannelId)
            : null;

          // ROLE LOGIC
          let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, cleanCompany));
          if (!role) role = await interaction.guild.roles.create({ name: cleanCompany, color: 0x3498db });

          await member.roles.add(role);
          await member.setNickname(`${cleanName} | ${acronym}`).catch(() => null);

          // HIDE WELCOME & WIPE
          if (welcomeChan) {
            await welcomeChan.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false }).catch(() => null);
            await welcomeChan.permissionOverwrites.edit(role.id, { ViewChannel: false }).catch(() => null);
            await welcomeChan.permissionOverwrites.edit(member.id, { ViewChannel: false }).catch(() => null);

            // Clone to wipe history
            const newChannel = await welcomeChan.clone();
            await welcomeChan.delete().catch(() => null);
            await newChannel.setPosition(welcomeChan.position);
          }

          // CREATE CHANNELS
          const category = await interaction.guild.channels.create({
            name: cleanCompany,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
            ]
          });

          await interaction.guild.channels.create({ name: 'general', type: ChannelType.GuildText, parent: category.id });
          await interaction.guild.channels.create({ name: 'Voice Call', type: ChannelType.GuildVoice, parent: category.id });

          // DM
          await member.send(`✅ **Approved!** Welcome to the server 🎉`).catch(() => null);
          const rulesEmbed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle("📜 Rules")
            .setDescription("• Be respectful\n• No spam\n• Follow professional guidelines");
          await member.send({ embeds: [rulesEmbed] }).catch(() => null);

          await interaction.editReply({ content: `✅ Approved **${cleanName}**`, components: [] });
          onboardingData.delete(userId);
          processingUsers.delete(userId);
        }

        if (action === 'deny') {
          onboardingData.delete(userId);
          return interaction.update({ content: "❌ Denied", components: [] });
        }
      }

      // BROADCAST START
      if (interaction.customId === "start_broadcast") {
        const dropdown = await buildDropdown(interaction.guild);
        await interaction.reply({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)],
          flags: [4096]
        });
        const reply = await interaction.fetchReply();
        session.set(interaction.user.id, { message: reply });
      }
    }

    // =========================
    // MODAL SUBMIT
    // =========================
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');

        // Store data
        const currentData = onboardingData.get(interaction.user.id) || {};
        onboardingData.set(interaction.user.id, {
          ...currentData,
          name: name,
          company: company
        });

        // Safely find Admin Channel
        const adminChan = interaction.guild.channels.cache.find(c =>
          c.name.toLowerCase().includes("admin") && c.type === ChannelType.GuildText
        );

        if (!adminChan) {
          return interaction.reply({ 
            content: "❌ Error: Admin text channel not found.", 
            flags: [4096] 
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        await adminChan.send({
          content: `🔔 **New Request**\n**User:** <@${interaction.user.id}>\n**Name:** ${name}\n**Company:** ${company}`,
          components: [row]
        });

        return interaction.reply({ content: "✅ Request sent to admins.", flags: [4096] });
      }
    }

  } catch (err) {
    console.error("Interaction Error:", err);
  }
});

// =========================
// DM SYSTEM
// =========================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.guild) return;
  if (repliedUsers.has(message.author.id)) return;

  await message.reply("📩 **Inter Molds System**\nThis bot is for notifications only.");
  repliedUsers.add(message.author.id);
});

client.login(process.env.TOKEN);
