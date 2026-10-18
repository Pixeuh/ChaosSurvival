import { project, VIEW_WIDTH, VIEW_HEIGHT } from './model.js';

function polygon(ctx, points, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fill();
}
function tile(ctx, x, y, color) {
  polygon(
    ctx,
    [
      [x, y - 8],
      [x + 16, y],
      [x, y + 8],
      [x - 16, y],
    ],
    color,
  );
}
function block(ctx, point, height, top, left, right) {
  const { x, y } = point;
  polygon(
    ctx,
    [
      [x - 15, y],
      [x, y + 7],
      [x, y + 7 - height],
      [x - 15, y - height],
    ],
    left,
  );
  polygon(
    ctx,
    [
      [x, y + 7],
      [x + 15, y],
      [x + 15, y - height],
      [x, y + 7 - height],
    ],
    right,
  );
  tile(ctx, x, y - height, top);
}
function person(ctx, point, color, direction, stride = 0, hair = '#543c32') {
  const x = Math.round(point.x),
    y = Math.round(point.y);
  tile(ctx, x, y + 1, '#69797c');
  ctx.fillStyle = '#243047';
  ctx.fillRect(x - 6, y - 12 - stride, 5, 12 + stride);
  ctx.fillRect(x + 1, y - 12 + stride, 5, 12 - stride);
  ctx.fillStyle = '#172438';
  ctx.fillRect(x - 7, y - 2 - stride, 7, 3);
  ctx.fillRect(x + 1, y - 2 + stride, 7, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x - 7, y - 26, 14, 16);
  ctx.fillRect(x - 10, y - 23, 3, 11);
  ctx.fillRect(x + 7, y - 23, 3, 11);
  ctx.fillStyle = '#efba86';
  ctx.fillRect(x - 6, y - 37, 12, 12);
  ctx.fillRect(x - 10, y - 13, 3, 3);
  ctx.fillRect(x + 7, y - 13, 3, 3);
  ctx.fillStyle = hair;
  ctx.fillRect(x - 7, y - 39, 14, 5);
  if (['north', 'west'].includes(direction)) ctx.fillRect(x - 6, y - 34, 12, 7);
  else {
    ctx.fillStyle = '#243047';
    ctx.fillRect(x + (direction === 'east' ? 2 : -4), y - 32, 2, 2);
    ctx.fillRect(x + (direction === 'east' ? 5 : 2), y - 32, 2, 2);
  }
  // A small sleeve highlight makes all four facings distinct, including back views.
  ctx.fillStyle = '#e7eff1';
  ctx.fillRect(x + (['east', 'north'].includes(direction) ? 5 : -7), y - 25, 2, 6);
}
function furniture(ctx, room, item) {
  const [width, height] = item.size ?? [1, 1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const point = project(item.position[0] + x, item.position[1] + y, room);
      if (item.type === 'sofa') {
        block(ctx, point, 12, item.color ?? '#ea8665', '#944834', '#bc6045');
        block(
          ctx,
          { x: point.x, y: point.y - 8 },
          22,
          item.color ?? '#ffab78',
          '#bb684b',
          '#d77e59',
        );
      } else if (item.type === 'table') {
        ctx.fillStyle = '#6d5137';
        ctx.fillRect(point.x - 10, point.y - 12, 3, 16);
        ctx.fillRect(point.x + 7, point.y - 12, 3, 16);
        block(ctx, { x: point.x, y: point.y - 13 }, 3, '#efd796', '#ad8750', '#d3b070');
      } else if (item.type === 'plant') {
        block(ctx, point, 12, '#b17550', '#74452f', '#986449');
        ctx.fillStyle = '#315f3a';
        ctx.fillRect(point.x - 2, point.y - 33, 4, 23);
        ctx.fillStyle = '#54a350';
        ctx.fillRect(point.x - 12, point.y - 32, 12, 7);
        ctx.fillRect(point.x + 1, point.y - 37, 10, 7);
        ctx.fillRect(point.x - 8, point.y - 44, 10, 9);
      } else if (item.type === 'counter') {
        block(ctx, point, 25, '#f8d679', '#9c6b38', '#bb8b48');
        ctx.fillStyle = '#fff0bd';
        ctx.fillRect(point.x - 6, point.y - 21, 10, 2);
      } else if (item.type === 'chair') {
        block(ctx, point, 11, '#a87451', '#654936', '#80593e');
        block(ctx, { x: point.x, y: point.y - 8 }, 22, '#d8a571', '#805b40', '#aa784b');
      } else if (item.type === 'speaker') {
        block(ctx, point, 35, '#536374', '#25303e', '#37414f');
        ctx.fillStyle = '#111e2d';
        ctx.fillRect(point.x - 6, point.y - 30, 12, 10);
        ctx.fillRect(point.x - 6, point.y - 16, 12, 10);
        ctx.fillStyle = '#90a3b1';
        ctx.fillRect(point.x - 2, point.y - 27, 4, 4);
        ctx.fillRect(point.x - 2, point.y - 13, 4, 4);
      } else if (item.type === 'arcade') {
        block(ctx, point, 39, item.color ?? '#558eae', '#314857', '#496b78');
        ctx.fillStyle = '#18273a';
        ctx.fillRect(point.x - 10, point.y - 32, 20, 13);
        ctx.fillStyle = '#8ee5b2';
        ctx.fillRect(point.x - 6, point.y - 29, 5, 5);
        ctx.fillStyle = '#9ecff0';
        ctx.fillRect(point.x + 2, point.y - 25, 4, 3);
        ctx.fillStyle = '#e9bf6d';
        ctx.fillRect(point.x - 8, point.y - 15, 3, 3);
        ctx.fillStyle = '#f4a49c';
        ctx.fillRect(point.x + 4, point.y - 15, 3, 3);
      }
    }
}
export function depthOrder(room, walk) {
  return [
    ...room.furniture.map((item) => ({
      kind: 'furniture',
      item,
      depth:
        item.position[0] +
        item.position[1] +
        ((item.size?.[0] ?? 1) - 1) +
        ((item.size?.[1] ?? 1) - 1),
    })),
    ...room.npcs.map((item) => ({ kind: 'npc', item, depth: item.position[0] + item.position[1] })),
    { kind: 'player', depth: walk.position[0] + walk.position[1] },
  ].sort((a, b) => a.depth - b.depth);
}
export function drawRoom(ctx, room, walk) {
  const palette = room.palette ?? {};
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  const start = project(0, 0, room),
    left = project(0, room.height - 1, room),
    right = project(room.width - 1, 0, room);
  polygon(
    ctx,
    [
      [start.x, start.y - 8],
      [left.x - 16, left.y],
      [left.x - 16, left.y - 64],
      [start.x, start.y - 72],
    ],
    palette.wallLeft ?? '#57a9b4',
  );
  polygon(
    ctx,
    [
      [start.x, start.y - 8],
      [right.x + 16, right.y],
      [right.x + 16, right.y - 64],
      [start.x, start.y - 72],
    ],
    palette.wallRight ?? '#387f99',
  );
  for (const light of room.decor?.lights ?? []) {
    const point = project(...light.position, room);
    ctx.fillStyle = '#303147';
    ctx.fillRect(point.x - 5, point.y - 59, 10, 7);
    ctx.fillStyle = light.color;
    ctx.fillRect(point.x - 3, point.y - 57, 6, 3);
  }
  for (let depth = 0; depth < room.width + room.height - 1; depth++) {
    for (let x = 0; x < room.width; x++) {
      const y = depth - x;
      if (y < 0 || y >= room.height) continue;
      const point = project(x, y, room);
      tile(ctx, point.x, point.y, palette.tileBorder ?? '#bda776');
      const area = room.decor?.floorAreas?.find(
        (area) =>
          x >= area.position[0] &&
          y >= area.position[1] &&
          x < area.position[0] + area.size[0] &&
          y < area.position[1] + area.size[1],
      );
      const colors = area?.colors ?? [palette.floorB ?? '#f4e5bc', palette.floorA ?? '#e9d6a1'];
      polygon(
        ctx,
        [
          [point.x, point.y - 7],
          [point.x + 14, point.y],
          [point.x, point.y + 6],
          [point.x - 14, point.y],
        ],
        colors[(x + y) % colors.length],
      );
    }
  }
  for (const entry of depthOrder(room, walk)) {
    if (entry.kind === 'furniture') furniture(ctx, room, entry.item);
    else if (entry.kind === 'npc')
      person(
        ctx,
        project(...entry.item.position, room),
        entry.item.appearance?.shirt ?? '#f3bf43',
        entry.item.direction,
        entry.item.walk?.moving ? (Math.floor(entry.item.walk.elapsed / 120) % 2 ? 1 : -1) : 0,
        entry.item.appearance?.hair ?? '#543c32',
      );
    else
      person(
        ctx,
        project(...walk.position, room),
        '#a284dc',
        walk.direction,
        walk.moving ? (Math.floor(walk.elapsed / 120) % 2 ? 1 : -1) : 0,
      );
  }
}
