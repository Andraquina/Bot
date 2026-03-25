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

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
});

// =========================
// HELPERS
// =========================
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatTitleCase(str) {
  return str.toLowerCase().split(/\s+/)
    .filter(w => w.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getAcronym(company) {
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

    // SLASH
    if (interaction.isChatInputCommand() && interaction.commandName === "setup-broadcast") {
      const button = new ButtonBuilder()
        .setCustomId("start_broadcast")
        .setLabel("📢 Start Broadcast")
        .setStyle(ButtonStyle.Primary);

      await interaction.channel.send({
        content: "📢 **Broadcast Panel**",
        components: [new ActionRowBuilder().addComponents(button)]
      });

      return interaction.reply({ content: "✅ Panel created.", ephemeral: true });
    }

    // BUTTONS
    if (interaction.isButton()) {

      if (interaction.customId === 'open_onboarding_modal') {
        const modal = new ModalBuilder()
          .setCustomId('onboarding_modal')
          .setTitle('Company Registration');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('user_name').setLabel('Your Name').setStyle(TextInputStyle.Short)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('company_name').setLabel('Company').setStyle(TextInputStyle.Short)
          )
        );

        return interaction.showModal(modal);
      }

      // APPROVE / DENY
      if (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_')) {

        const [action, userId] = interaction.customId.split('_');
        const data = onboardingData.get(userId);
        if (!data) return;

        if (action === 'approve') {

          await interaction.deferReply({ ephemeral: true });

          const member = await interaction.guild.members.fetch(userId);
          const cleanName = formatTitleCase(data.name);
          const cleanCompany = formatTitleCase(data.company);
          const acronym = getAcronym(cleanCompany);

          let role = interaction.guild.roles.cache.find(r => isSameCompany(r.name, cleanCompany));
          if (!role) role = await interaction.guild.roles.create({ name: cleanCompany });

          await member.roles.add(role);
          await member.setNickname(`${cleanName} | ${acronym}`);

          // RULE CHANNEL ACCESS
          for (const ch of interaction.guild.channels.cache.values()) {
            if (ch.name.toLowerCase().includes("announcement") || ch.name.toLowerCase().includes("rule")) {
              await ch.permissionOverwrites.edit(role.id, {
                ViewChannel: true,
                ReadMessageHistory: true,
                SendMessages: false
              }).catch(()=>{});
            }
          }

          // CREATE CATEGORY
          const category = await interaction.guild.channels.create({
            name: cleanCompany,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
            ]
          });

          const perms = [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
            PermissionsBitField.Flags.AddReactions
          ];

          await interaction.guild.channels.create({
            name: 'general',
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: role.id, allow: perms }
            ]
          });

          await interaction.guild.channels.create({
            name: 'Voice Call',
            type: ChannelType.GuildVoice,
            parent: category.id,
            permissionOverwrites: [
              { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: role.id, allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak
              ]}
            ]
          });

          await member.send(`✅ You've been approved! Welcome to **Inter Molds, Inc.** 🎉`);
          await member.send({
            embeds: [new EmbedBuilder().setTitle("📜 Rules").setDescription("• Be respectful\n• No spam\n• Follow rules")]
          });

          await interaction.editReply({
            content: `✅ Approved ${cleanName} (${cleanCompany})`
          });

          await interaction.message.delete().catch(()=>{});
        }

        if (action === 'deny') {
          await interaction.update({
            content: `❌ Denied ${data.name}`,
            components: []
          });

          await interaction.message.delete().catch(()=>{});
        }
      }

      // BROADCAST START
      if (interaction.customId === "start_broadcast") {
        await interaction.deferReply();
        const dropdown = await buildDropdown(interaction.guild);
        const reply = await interaction.editReply({
          content: "🎯 Select companies:",
          components: [new ActionRowBuilder().addComponents(dropdown)]
        });
        session.set(interaction.user.id, { message: reply });
      }

      // BACK / CANCEL / CONFIRM handled same as before
    }

    // SELECT
    if (interaction.isStringSelectMenu()) {
      const data = session.get(interaction.user.id) || {};
      session.set(interaction.user.id, { ...data, targets: interaction.values });

      const modal = new ModalBuilder()
        .setCustomId("broadcast_modal")
        .setTitle("Broadcast Message");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("message").setLabel("Message").setStyle(TextInputStyle.Paragraph)
        )
      );

      return interaction.showModal(modal);
    }

    // MODALS
    if (interaction.isModalSubmit()) {

      // FIXED ONBOARDING
      if (interaction.customId === 'onboarding_modal') {
        const name = interaction.fields.getTextInputValue('user_name');
        const company = interaction.fields.getTextInputValue('company_name');

        onboardingData.set(interaction.user.id, { name, company });

        const adminChan = interaction.guild.channels.cache.find(c =>
          c.name.toLowerCase().includes("admin")
        );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        await adminChan.send({
          content: `🚨 New request\nUser: <@${interaction.user.id}>\nName: ${name}\nCompany: ${company}`,
          components: [row]
        });

        return interaction.reply({ content: "✅ Sent to admins.", ephemeral: true });
      }
    }

  } catch (err) {
    console.error(err);
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
