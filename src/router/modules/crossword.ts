const Layout = () => import("@/layout/index.vue");

export default {
  path: "/crossword",
  name: "Crossword",
  component: Layout,
  redirect: "/crossword/puzzles",
  meta: {
    icon: "ep/grid",
    title: "字谜",
    rank: 1
  },
  children: [
    {
      path: "/crossword/puzzles",
      name: "CrosswordPuzzles",
      component: () => import("@/views/crossword/puzzles/index.vue"),
      meta: {
        icon: "ep/document",
        title: "谜题"
      }
    },
    {
      path: "/crossword/lexicons",
      name: "CrosswordLexicons",
      component: () => import("@/views/crossword/lexicons/index.vue"),
      meta: {
        icon: "ep/notebook",
        title: "词库"
      }
    },
    {
      path: "/crossword/levels",
      name: "CrosswordLevels",
      component: () => import("@/views/crossword/levels/index.vue"),
      meta: {
        icon: "ep/trophy",
        title: "关卡"
      }
    },
    {
      path: "/crossword/daily",
      name: "CrosswordDaily",
      component: () => import("@/views/crossword/daily/index.vue"),
      meta: {
        icon: "ep/calendar",
        title: "每日"
      }
    }
  ]
} satisfies RouteConfigsTable;
