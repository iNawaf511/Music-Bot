import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const COLOR_SUCCESS = 0x1DB954;
const COLOR_ERROR = 0xFF4444;
const COLOR_INFO = 0x5865F2;
const COLOR_WARNING = 0xFFA500;

export function nowPlayingEmbed(track) {
  return new EmbedBuilder()
    .setColor(COLOR_SUCCESS)
    .setTitle('🎵 يعزف الآن')
    .setDescription(`**[${track.title}](${track.url})**`)
    .setThumbnail(track.thumbnail || null)
    .addFields(
      { name: '⏱ المدة', value: track.duration || '?:??', inline: true },
      { name: '👤 طُلب بواسطة', value: track.requestedBy || 'غير معروف', inline: true }
    )
    .setFooter({ text: 'بوت الموسيقى 🎶' });
}

export function startedPlayingEmbed(track, loopInfo) {
  const embed = new EmbedBuilder()
    .setColor(0x2B2D31)
    .setAuthor({ name: '▶  Started Playing' })
    .setTitle(track.title)
    .setURL(track.url)
    .setImage(track.thumbnail || null)
    .addFields(
      { name: '🎤 Author:', value: track.author || 'Unknown', inline: true },
      { name: '🕐 Song Duration:', value: track.duration || '?:??', inline: true },
      { name: '👤 Requester:', value: track.requestedBy || 'Unknown', inline: true },
    )
    .setFooter({ text: loopInfo?.label || '❌ لا يوجد تكرار' });
  return embed;
}

export function controlButtons(isPaused = false, stayEnabled = false) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ctrl_stop')
      .setEmoji('⏹')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ctrl_seek')
      .setEmoji('⏩')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(isPaused ? 'ctrl_resume' : 'ctrl_pause')
      .setEmoji(isPaused ? '▶️' : '⏸')
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ctrl_skip')
      .setEmoji('⏭')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ctrl_loop')
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ctrl_shuffle')
      .setEmoji('🔀')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ctrl_vol_down')
      .setEmoji('🔉')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ctrl_stay')
      .setEmoji('📌')
      .setStyle(stayEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ctrl_vol_up')
      .setEmoji('🔊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ctrl_queue')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2];
}

export function addedToQueueEmbed(track, position) {
  return new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setTitle('✅ أُضيف إلى قائمة التشغيل')
    .setDescription(`**[${track.title}](${track.url})**`)
    .setThumbnail(track.thumbnail || null)
    .addFields(
      { name: '📍 الموضع في القائمة', value: `#${position}`, inline: true },
      { name: '⏱ المدة', value: track.duration || '?:??', inline: true }
    );
}

export function queueEmbed(currentTrack, tracks, page = 0) {
  const pageSize = 10;
  const start = page * pageSize;
  const end = Math.min(start + pageSize, tracks.length);
  const pageItems = tracks.slice(start, end);

  const embed = new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setTitle('📋 قائمة التشغيل');

  if (currentTrack) {
    embed.addFields({
      name: '🎵 يعزف الآن',
      value: `**[${currentTrack.title}](${currentTrack.url})**`
    });
  }

  if (pageItems.length === 0) {
    embed.setDescription('قائمة التشغيل فارغة');
  } else {
    const list = pageItems.map((t, i) =>
      `**${start + i + 1}.** [${t.title}](${t.url}) - \`${t.duration}\` | ${t.requestedBy}`
    ).join('\n');
    embed.addFields({ name: `الأغاني التالية (${tracks.length} أغنية)`, value: list });
  }

  if (tracks.length > pageSize) {
    embed.setFooter({ text: `صفحة ${page + 1} / ${Math.ceil(tracks.length / pageSize)}` });
  }

  return embed;
}

export function errorEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLOR_ERROR)
    .setTitle('❌ خطأ')
    .setDescription(message);
}

export function successEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLOR_SUCCESS)
    .setDescription(`✅ ${message}`);
}

export function infoEmbed(title, message) {
  return new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setTitle(title)
    .setDescription(message);
}

export function downloadEmbed(url, format) {
  const formatName = format === 'audio' ? 'صوت MP3' : format === 'video' ? 'فيديو MP4' : 'صوت + فيديو MP4';
  return new EmbedBuilder()
    .setColor(COLOR_WARNING)
    .setTitle('⏳ جاري التحميل...')
    .setDescription(`**الرابط:** ${url}\n**النوع:** ${formatName}\n\nانتظر قليلاً...`);
}

export function loopEmbed(loopInfo) {
  return new EmbedBuilder()
    .setColor(COLOR_SUCCESS)
    .setTitle('🔁 وضع التكرار')
    .setDescription(loopInfo.label);
}

export function stayEmbed(enabled, untilDate) {
  if (!enabled) {
    return new EmbedBuilder()
      .setColor(COLOR_WARNING)
      .setTitle('🚪 وضع البقاء')
      .setDescription('تم **إيقاف** وضع البقاء. سيغادر البوت عند انتهاء الموسيقى.');
  }
  const timestamp = Math.floor(untilDate.getTime() / 1000);
  return new EmbedBuilder()
    .setColor(COLOR_SUCCESS)
    .setTitle('📌 وضع البقاء مفعّل')
    .setDescription(`سيبقى البوت في القناة الصوتية حتى <t:${timestamp}:R>\n*(24 ساعة من الآن)*`);
}

export function botChannelEmbed(channels) {
  if (channels.length === 0) {
    return new EmbedBuilder()
      .setColor(COLOR_INFO)
      .setTitle('📢 قنوات البوت')
      .setDescription('✅ البوت مسموح له في **جميع القنوات** حالياً.\n\nاستخدم `/setbotchannel add` لتقييد القنوات.');
  }
  const list = channels.map(id => `<#${id}>`).join('\n');
  return new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setTitle('📢 قنوات البوت المسموح بها')
    .setDescription(`البوت يعمل فقط في هذه القنوات:\n\n${list}\n\nلإزالة التقييد استخدم \`/setbotchannel clear\``);
}
