/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { 
  Building2, 
  Home, 
  RefreshCcw, 
  MapPin, 
  Phone, 
  Mail, 
  Star, 
  CheckCircle2, 
  ArrowRight,
  Menu,
  X,
  LayoutGrid,
  Paintbrush,
  Hammer,
  ClipboardCheck,
  Search,
  Plus,
  Trash2,
  Edit,
  Camera,
  LogOut,
  Settings
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// --- Types ---

interface Project {
  id: string;
  type: string;
  title: string;
  loc: string;
  image: string; // URL or Base64
  desc?: string;
  completedAt: string;
}

// --- Icons / Assets ---

const DEFAULT_PROJECTS: Project[] = [
  { id: "1", type: "Residential", title: "The Goldcrest Villa", loc: "Lahore, Punjab", image: "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&q=80&w=800", completedAt: "2024-05-10" },
  { id: "2", type: "Commercial", title: "Prime Business Centre", loc: "Islamabad, ICT", image: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=800", completedAt: "2024-02-15" },
  { id: "3", type: "Luxury Residential", title: "Maple Grove Residence", loc: "Karachi, Sindh", image: "https://images.unsplash.com/photo-1600585154340-be6191da1128?auto=format&fit=crop&q=80&w=800", completedAt: "2023-11-20" },
  { id: "4", type: "Mixed-Use", title: "New Range Plaza", loc: "Rawalpindi, Punjab", image: "https://images.unsplash.com/photo-1590348697171-07355152be53?auto=format&fit=crop&q=80&w=800", completedAt: "2023-08-05" },
].map(p => ({ ...p, id: `seed-${p.id}` }));

// --- Components ---

const Navbar = ({ onAdminClick }: { onAdminClick: () => void }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: "Services", href: "#services" },
    { name: "About", href: "#about" },
    { name: "Projects", href: "#projects" },
    { name: "Process", href: "#process" },
    { name: "Reviews", href: "#testimonials" },
  ];

  return (
    <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${isScrolled ? "bg-black/90 backdrop-blur-md py-3 border-b border-gold/20" : "bg-transparent py-5"}`}>
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        <a href="#" className="flex items-center gap-2">
          <span className="font-serif text-2xl font-bold tracking-tight">
            NEW RANGE <span className="text-gold">HOMES</span>
          </span>
        </a>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a 
              key={link.name} 
              href={link.href} 
              className="text-white/70 hover:text-gold text-xs font-semibold uppercase tracking-widest transition-colors"
            >
              {link.name}
            </a>
          ))}
          <button 
            onClick={onAdminClick}
            className="flex items-center gap-2 text-white/40 hover:text-gold text-[10px] font-bold uppercase tracking-widest transition-colors"
          >
            <Settings size={12} /> Management
          </button>
        </div>

        {/* Mobile Toggle */}
        <button 
          className="md:hidden text-white"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-full left-0 w-full bg-black border-b border-gold/20 p-6 md:hidden"
          >
            <div className="flex flex-col gap-4">
              {navLinks.map((link) => (
                <a 
                  key={link.name} 
                  href={link.href} 
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-white/70 hover:text-gold text-sm font-semibold uppercase tracking-widest py-2"
                >
                  {link.name}
                </a>
              ))}
              <button 
                onClick={() => { setMobileMenuOpen(false); onAdminClick(); }}
                className="text-white/70 hover:text-gold text-sm font-semibold uppercase tracking-widest py-2 flex items-center gap-2"
              >
                <Settings size={16} /> Management
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

const SectionTitle = ({ label, title, subtitle, centered = false }: { label: string, title: string, subtitle?: string, centered?: boolean }) => (
  <div className={`mb-16 ${centered ? "text-center max-w-2xl mx-auto" : ""}`}>
    <motion.span 
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="inline-block text-gold text-[10px] font-bold uppercase tracking-[0.25em] mb-3"
    >
      {label}
    </motion.span>
    <motion.h2 
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: 0.1 }}
      className="font-serif text-3xl md:text-5xl font-bold leading-tight mb-6"
    >
      {title}
    </motion.h2>
    <motion.div 
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true }}
      transition={{ delay: 0.2, duration: 0.8 }}
      className={`h-0.5 bg-gold w-12 mb-6 ${centered ? "mx-auto" : ""}`}
    />
    {subtitle && (
      <motion.p 
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.3 }}
        className="text-white/50 text-sm md:text-base font-light leading-relaxed"
      >
        {subtitle}
      </motion.p>
    )}
  </div>
);

// --- Admin Sub-Components ---

const ProjectForm = ({ onSave, onCancel, initialData }: { onSave: (p: Partial<Project>) => void, onCancel: () => void, initialData?: Project }) => {
  const [formData, setFormData] = useState<Partial<Project>>(initialData || {
    type: "Residential",
    title: "",
    loc: "",
    image: "",
    completedAt: new Date().toISOString().split('T')[0]
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, image: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="bg-black-card border border-gold/20 p-8 rounded-sm">
      <h3 className="font-serif text-2xl font-bold mb-6">{initialData ? "Edit Project" : "Add New Project"}</h3>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Project Title</label>
            <input 
              value={formData.title} 
              onChange={e => setFormData({...formData, title: e.target.value})}
              className="w-full bg-black border border-gold/10 p-3 text-sm focus:border-gold outline-none" 
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Project Type</label>
            <select 
              value={formData.type} 
              onChange={e => setFormData({...formData, type: e.target.value})}
              className="w-full bg-black border border-gold/10 p-3 text-sm focus:border-gold outline-none"
            >
              <option>Residential</option>
              <option>Commercial</option>
              <option>Luxury Residential</option>
              <option>Renovation</option>
              <option>Mixed-Use</option>
            </select>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Location</label>
            <input 
              value={formData.loc} 
              onChange={e => setFormData({...formData, loc: e.target.value})}
              className="w-full bg-black border border-gold/10 p-3 text-sm focus:border-gold outline-none" 
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Completion Date</label>
            <input 
              type="date"
              value={formData.completedAt} 
              onChange={e => setFormData({...formData, completedAt: e.target.value})}
              className="w-full bg-black border border-gold/10 p-3 text-sm focus:border-gold outline-none" 
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Project Photo</label>
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="w-full aspect-[2/1] border border-dashed border-gold/20 flex flex-col items-center justify-center cursor-pointer hover:bg-gold/5 transition-colors overflow-hidden"
          >
            {formData.image ? (
              <img src={formData.image} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <>
                <Camera className="text-gold mb-2" />
                <span className="text-xs text-white/40">Click to upload photo</span>
              </>
            )}
            <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleFileChange} />
          </div>
        </div>

        <div className="flex gap-4 pt-4">
          <button 
            onClick={() => onSave(formData)}
            className="flex-1 py-3 bg-gold text-black font-bold uppercase tracking-widest text-xs"
          >
            {initialData ? "Update Project" : "Save Project"}
          </button>
          <button 
            onClick={onCancel}
            className="px-6 py-3 border border-white/20 text-white/60 font-bold uppercase tracking-widest text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem("range-homes-projects");
    return saved ? JSON.parse(saved) : DEFAULT_PROJECTS;
  });
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    localStorage.setItem("range-homes-projects", JSON.stringify(projects));
  }, [projects]);

  const handleSaveProject = (p: Partial<Project>) => {
    if (isEditing) {
      setProjects(prev => prev.map(item => item.id === isEditing ? { ...item, ...p } as Project : item));
      setIsEditing(null);
    } else {
      const newProject: Project = {
        ...p,
        id: Math.random().toString(36).substr(2, 9),
      } as Project;
      setProjects([newProject, ...projects]);
      setShowAddForm(false);
    }
  };

  const handleDeleteProject = (id: string) => {
    if (confirm("Are you sure you want to delete this project?")) {
      setProjects(prev => prev.filter(p => p.id !== id));
    }
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(projects, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'new-range-homes-portfolio.json';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target?.result as string);
          if (Array.isArray(imported)) {
            setProjects(imported);
            alert("Portfolio imported successfully!");
          }
        } catch (error) {
          alert("Error importing file. Please ensure it's a valid JSON.");
        }
      };
      reader.readAsText(file);
    }
  };

  if (isAdmin) {
    return (
      <div className="min-h-screen bg-black">
        <nav className="bg-black border-b border-gold/20 py-4 px-6 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="font-serif text-xl font-bold">
              ADMIN <span className="text-gold">PORTAL</span>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleExport}
                  className="text-white/40 hover:text-gold text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-1"
                >
                  <Search size={12} className="rotate-90" /> Export Backup
                </button>
                <label className="text-white/40 hover:text-gold text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center gap-1 cursor-pointer">
                  <RefreshCcw size={12} /> Import Backup
                  <input type="file" hidden accept=".json" onChange={handleImport} />
                </label>
              </div>
              <button 
                onClick={() => setIsAdmin(false)}
                className="flex items-center gap-2 text-white/60 hover:text-gold text-xs font-bold uppercase tracking-widest transition-colors"
              >
                <LogOut size={14} /> Back to Site
              </button>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
            <SectionTitle 
              label="Manager" 
              title="Project Portfolio" 
              subtitle="Add, edit, or remove completed projects from the company showcase."
            />
            {!showAddForm && !isEditing && (
              <button 
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-2 px-8 py-4 bg-gold text-black font-bold uppercase tracking-widest text-xs self-start"
              >
                <Plus size={16} /> Add New Project
              </button>
            )}
          </div>

          <div className="grid lg:grid-cols-3 gap-8 items-start">
            {/* Form Column */}
            {(showAddForm || isEditing) && (
              <div className="lg:col-span-1 sticky top-24">
                <ProjectForm 
                  initialData={isEditing ? projects.find(p => p.id === isEditing) : undefined}
                  onSave={handleSaveProject}
                  onCancel={() => { setShowAddForm(false); setIsEditing(null); }}
                />
              </div>
            )}

            {/* List Column */}
            <div className={`${(showAddForm || isEditing) ? "lg:col-span-2" : "lg:col-span-3"} space-y-4`}>
              {projects.map(p => (
                <div key={p.id} className="bg-black-card border border-gold/10 p-6 flex flex-col sm:flex-row gap-6 items-center group">
                  <div className="w-full sm:w-32 aspect-square bg-black border border-white/5 overflow-hidden shrink-0">
                    <img src={p.image} alt={p.title} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 text-center sm:text-left">
                    <div className="text-gold text-[10px] font-bold uppercase tracking-widest mb-1">{p.type}</div>
                    <h4 className="font-serif text-lg font-bold">{p.title}</h4>
                    <p className="text-white/40 text-xs mt-1 flex items-center gap-1 justify-center sm:justify-start">
                      <MapPin size={10} /> {p.loc}
                    </p>
                    <div className="text-[10px] text-white/20 mt-2 uppercase tracking-widest">Completed: {p.completedAt}</div>
                  </div>
                  <div className="flex items-center gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => { setIsEditing(p.id); setShowAddForm(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      className="p-3 bg-white/5 hover:bg-gold/10 text-white/40 hover:text-gold transition-colors"
                    >
                      <Edit size={16} />
                    </button>
                    <button 
                      onClick={() => handleDeleteProject(p.id)}
                      className="p-3 bg-white/5 hover:bg-red-500/10 text-white/40 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {projects.length === 0 && (
                <div className="text-center py-20 border border-dashed border-gold/20">
                  <p className="text-white/40 italic">No projects found. Start adding your portfolio!</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-black">
      <Navbar onAdminClick={() => setIsAdmin(true)} />

      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-black-soft">
        <div className="absolute inset-0 bg-grid-gold" />
        <div className="absolute right-0 top-0 bottom-0 w-1/3 md:w-[45%] bg-gradient-to-b from-gold/10 to-gold/5 border-l border-gold/20 hidden md:block" style={{ clipPath: "polygon(15% 0, 100% 0, 100% 100%, 0% 100%)" }} />
        
        <div className="relative z-10 max-w-7xl mx-auto px-6 w-full py-20">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="max-w-2xl"
          >
            <span className="inline-block px-4 py-1.5 border border-gold/40 text-gold text-[10px] font-bold uppercase tracking-[0.2em] mb-8">
              Premium Construction & Development
            </span>
            <h1 className="font-serif text-5xl md:text-8xl font-black leading-[1.05] tracking-tight mb-8">
              Building <span className="text-gold italic">Homes</span><br />
              That Last a<br />
              Lifetime
            </h1>
            <p className="text-white/60 text-base md:text-lg font-light leading-relaxed max-w-md mb-10">
              New Range Homes delivers exceptional construction quality with a commitment to craftsmanship, precision, and timeless design.
            </p>
            <div className="flex flex-wrap gap-4">
              <a href="#projects" className="px-8 py-4 bg-gold text-black hover:bg-gold-light text-xs font-bold uppercase tracking-widest transition-all">
                View Our Work
              </a>
              <a href="#contact" className="px-8 py-4 border border-white/30 text-white hover:border-gold hover:text-gold text-xs font-bold uppercase tracking-widest transition-all">
                Start a Project
              </a>
            </div>
          </motion.div>
        </div>

        {/* Stats Overlay */}
        <div className="absolute bottom-10 left-0 w-full z-10 px-6">
          <div className="max-w-7xl mx-auto border-t border-gold/20 pt-10 hidden sm:flex gap-12 md:gap-20">
            {[
              { val: `${240 + projects.length}+`, label: "Projects Completed" },
              { val: "15+", label: "Years Experience" },
              { val: "98%", label: "Client Satisfaction" },
              { val: `${projects.length + 46}+`, label: "Expert Team" }
            ].map((stat, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 + i * 0.1 }}
              >
                <div className="font-serif text-2xl md:text-3xl font-bold text-gold">{stat.val}</div>
                <div className="text-[10px] font-medium uppercase tracking-widest text-white/40 mt-1">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section id="services" className="py-24 bg-black-soft relative">
        <div className="max-w-7xl mx-auto px-6">
          <SectionTitle 
            label="What We Do" 
            title="Our Core Services" 
            subtitle="From concept to completion, we provide end-to-end construction solutions tailored to your vision and budget."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0.5 bg-gold/15 border border-gold/15">
            {[
              { icon: <Home className="w-8 h-8" />, title: "Residential Homes", desc: "Custom-built houses designed to your specifications, blending modern aesthetics with structural excellence." },
              { icon: <Building2 className="w-8 h-8" />, title: "Commercial Buildings", desc: "Professional commercial construction delivering functional, compliant, and striking spaces for business." },
              { icon: <RefreshCcw className="w-8 h-8" />, title: "Renovations", desc: "Complete home and commercial renovation services that breathe new life into existing structures." },
              { icon: <ClipboardCheck className="w-8 h-8" />, title: "Project Management", desc: "Full-cycle project coordination ensuring timelines are met and budgets are strictly respected." },
              { icon: <Paintbrush className="w-8 h-8" />, title: "Interior Fit-Outs", desc: "Premium interior finishing services including flooring, plastering, cabinetry, and elegant fixtures." },
              { icon: <Search className="w-8 h-8" />, title: "Consultation & Design", desc: "Expert architectural consultation and design planning to ensure your vision translates into reality." }
            ].map((service, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="group p-10 bg-black-card hover:bg-gold/5 transition-colors relative overflow-hidden"
              >
                <div className="text-gold mb-6 group-hover:scale-110 transition-transform duration-500">{service.icon}</div>
                <h3 className="font-serif text-xl font-bold mb-4">{service.title}</h3>
                <p className="text-white/40 text-sm font-light leading-relaxed">{service.desc}</p>
                <div className="absolute bottom-0 left-0 w-full h-1 bg-gold scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="py-24 bg-black">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-2 gap-16 items-center">
          <motion.div 
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative"
          >
            <div className="aspect-[4/3] bg-black-card border border-gold/20 flex items-center justify-center relative overflow-hidden">
              {/* Abstract Architectural SVG */}
              <svg viewBox="0 0 200 150" fill="none" stroke="#C9A84C" strokeWidth="0.8" className="w-[80%] h-[80%] opacity-20">
                <rect x="20" y="60" width="160" height="80" />
                <path d="M20 60L100 20L180 60" />
                <rect x="55" y="90" width="30" height="50" />
                <rect x="115" y="90" width="30" height="50" />
              </svg>
              <div className="absolute bottom-[-1.5rem] right-[-1.5rem] bg-gold text-black p-8 font-serif">
                <div className="text-4xl font-black leading-none">15+</div>
                <div className="text-[10px] font-bold uppercase tracking-widest mt-2">Years Building<br />Excellence</div>
              </div>
            </div>
          </motion.div>

          <div>
            <SectionTitle 
              label="About Us" 
              title="Built on Trust, Delivered with Pride" 
              subtitle="New Range Homes was founded with a single mission: to build homes and spaces that exceed expectations. Our team brings decades of combined experience to every brick laid."
            />
            <div className="space-y-4 mb-8">
              {[
                "Fully licensed & insured construction company",
                "Transparent pricing with no hidden costs",
                "On-time delivery with strict quality checks",
                "Sustainable building materials and practices",
                "Dedicated project manager for every client"
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-sm text-white/70">
                  <div className="w-1.5 h-1.5 bg-gold" />
                  {item}
                </div>
              ))}
            </div>
            <a href="#contact" className="inline-block px-8 py-4 bg-gold text-black font-bold uppercase tracking-widest text-xs">
              Work With Us
            </a>
          </div>
        </div>
      </section>

      {/* Projects Section */}
      <section id="projects" className="py-24 bg-black-mid">
        <div className="max-w-7xl mx-auto px-6">
          <SectionTitle 
            label="Portfolio" 
            title="Featured Projects" 
            centered 
            subtitle="A selection of our most celebrated builds across residential and commercial sectors."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0.5 bg-gold/10">
            {projects.map((p, i) => (
              <motion.div 
                key={p.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="group aspect-[4/3] relative overflow-hidden bg-black-card cursor-pointer"
              >
                <div className="absolute inset-0 flex items-center justify-center transition-all duration-700">
                  <img src={p.image} alt={p.title} className="w-full h-full object-cover opacity-30 group-hover:opacity-100 group-hover:scale-110 transition-all duration-700" />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent p-8 flex flex-col justify-end translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
                  <span className="text-gold text-[10px] font-bold uppercase tracking-widest mb-2">{p.type}</span>
                  <h3 className="font-serif text-xl font-bold">{p.title}</h3>
                  <p className="text-white/40 text-xs mt-1 flex items-center gap-1">
                    <MapPin size={10} /> {p.loc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Process Section */}
      <section id="process" className="py-24 bg-black-soft">
        <div className="max-w-7xl mx-auto px-6">
          <SectionTitle 
            label="Our Method" 
            title="Building Your Future" 
            subtitle="A streamlined, transparent process from your first call to the moment you turn the key."
          />
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { num: "01", title: "Consultation", desc: "We meet to understand your vision, goals, site conditions, and budget." },
              { num: "02", title: "Design & Planning", desc: "Detailed architectural plans, timelines, and a transparent cost estimate." },
              { num: "03", title: "Construction", desc: "Skilled crew at work with daily updates and strict quality control." },
              { num: "04", title: "Handover", desc: "Final walkthroughs, resolution, and full documentation handover." }
            ].map((step, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative p-8 border border-white/5 bg-black-card hover:border-gold/30 transition-all group"
              >
                <div className="font-serif text-5xl font-black text-gold/10 group-hover:text-gold/20 mb-6 transition-colors">{step.num}</div>
                <div className="w-8 h-0.5 bg-gold mb-6" />
                <h4 className="font-serif text-lg font-bold mb-3">{step.title}</h4>
                <p className="text-white/40 text-sm font-light leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-24 bg-black">
        <div className="max-w-7xl mx-auto px-6">
          <SectionTitle 
            label="Client Stories" 
            title="What Our Clients Say" 
            subtitle="Trust is built on results. Here is what some of our valued clients have to say about working with us."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { name: "Ahmed Raza", role: "Homeowner, Lahore", text: "New Range Homes transformed our plot into the dream home we always imagined. Their attention to detail was truly impressive." },
              { name: "Sana Khalid", role: "Business Owner, Isb", text: "Professional from start to finish. They completed our commercial fit-out on time and under budget. Highly recommended!" },
              { name: "Tariq Mahmood", role: "Investor, Karachi", text: "The renovation exceeded all our expectations. The crew was respectful and highly skilled. Our house looks brand new." }
            ].map((t, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="p-10 bg-black-card border border-gold/10 relative"
              >
                <div className="flex gap-1 mb-6">
                  {[...Array(5)].map((_, i) => <Star key={i} size={14} className="fill-gold stroke-gold" />)}
                </div>
                <blockquote className="text-white/60 text-sm italic font-light leading-relaxed mb-8">"{t.text}"</blockquote>
                <div>
                  <div className="text-gold text-sm font-bold uppercase tracking-widest">{t.name}</div>
                  <div className="text-white/30 text-[10px] uppercase font-medium mt-1">{t.role}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="py-24 bg-black-mid">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-20">
          <div>
            <SectionTitle 
              label="Get In Touch" 
              title="Start Your Project Today" 
              subtitle="Ready to build something extraordinary? Reach out and let's talk about making your vision a reality."
            />
            
            <div className="space-y-8 mt-12">
              {[
                { icon: <Phone size={18} />, label: "Phone", val: "+92 300 123 4567" },
                { icon: <Mail size={18} />, label: "Email", val: "info@newrangehomes.com" },
                { icon: <MapPin size={18} />, label: "Office", val: "Block C, Model Town, Lahore" }
              ].map((item, i) => (
                <div key={i} className="flex gap-5">
                  <div className="w-12 h-12 flex items-center justify-center border border-gold/30 text-gold shrink-0">
                    {item.icon}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-white/30 mb-1">{item.label}</div>
                    <div className="text-sm font-medium">{item.val}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-black-card p-10 border border-gold/10"
          >
            <form className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-white/40">First Name</label>
                  <input type="text" className="w-full bg-black border border-gold/20 p-4 text-sm focus:border-gold outline-none transition-colors" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-white/40">Last Name</label>
                  <input type="text" className="w-full bg-black border border-gold/20 p-4 text-sm focus:border-gold outline-none transition-colors" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-white/40">Project Type</label>
                <select className="w-full bg-black border border-gold/20 p-4 text-sm focus:border-gold outline-none transition-colors">
                  <option>Residential Construction</option>
                  <option>Commercial Development</option>
                  <option>Renovation & Remodel</option>
                  <option>Interior Fit-Out</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-white/40">Message</label>
                <textarea className="w-full bg-black border border-gold/20 p-4 text-sm focus:border-gold outline-none transition-colors min-h-[120px]" />
              </div>
              <button className="w-full py-4 bg-gold text-black font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2 group">
                Send Enquiry <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-black-soft border-t border-gold/10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="font-serif text-xl font-bold">
            NEW RANGE <span className="text-gold">HOMES</span>
          </div>
          <div className="text-white/30 text-[10px] uppercase tracking-widest">
            © 2025 New Range Homes. All rights reserved.
          </div>
          <div className="flex gap-8">
            {["Home", "Services", "Projects", "Contact"].map((item) => (
              <a key={item} href="#" className="text-white/40 hover:text-gold text-[10px] uppercase font-bold tracking-widest transition-colors">
                {item}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
