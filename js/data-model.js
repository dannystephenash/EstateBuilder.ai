// data-model.js — Project state, defaults, constants
// ═══════════════════════════════════════════════════════════
//  DATA MODEL
// ═══════════════════════════════════════════════════════════
const FT=0.3048;
const f2m=ft=>ft*FT;
const m2f=m=>m/FT;

const P={
  projectName:'Untitled Project',
  projectType:'midrise', // 'midrise' | 'highrise'

  // ── Brand metadata (cover page + footer of PDF reports) ─────────────
  // Set via console: setBrandInfo({companyName, tagline, preparedBy, preparedFor})
  // Logo: uploadBrandLogo() opens a file picker and stores base64 here.
  brand:{
    companyName:'EstateBuilder.ai',
    tagline:'Real Estate Development Feasibility',
    preparedBy:'',
    preparedFor:'',
    logo:''   // base64 data URL — '' = no logo
  },
  lot:{front:60, upperRight:80, stepEast:0, lowerRight:80, upperLeft:80, notchWest:0, lowerLeft:80, rear:60},
  set:{front:10, stepback:3, sideE:12, sideW:4, rear:10},
  flr:{gf:15, typ:10},
  vols:[],
  core:{
    elevX:0, elevZ:0, elevDir:'ns', elevAngle:0, numElevators:0,
    stairs:[]
  },
  roads:[
    {label:'STREET A (NORTH)',offZ:-10,angle:0,width:66,fontSize:14,side:'north'},
    {label:'STREET B (SOUTH)',offZ:10,angle:0,width:50,fontSize:14,side:'south'}
  ],
  landscape:[],
  unitPlan:{
    mode:'auto',
    corridorWidthFt:4,
    floors:[],
    unitTypes:[
      {type:'Studio',defaultSize:425,color:'#e8c87a'},
      {type:'1-Bedroom',defaultSize:550,color:'#c49ade'},
      {type:'1-Bed+Den',defaultSize:650,color:'#88bbdd'},
      {type:'2-Bedroom',defaultSize:750,color:'#8db4e8'},
      {type:'2-Bed+Den',defaultSize:875,color:'#a0d4a0'},
      {type:'3-Bedroom',defaultSize:1050,color:'#e8a08d'}
    ]
  }
};

// Baked-in massing from saved project
// No default volumes — user draws buildings on the site map

