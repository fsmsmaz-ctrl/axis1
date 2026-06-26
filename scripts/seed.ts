// AXIS Pipe Jacking Management System - Seed Data
import { db } from '../src/lib/db'
import bcrypt from 'bcryptjs'

async function main() {
  console.log('🌱 Seeding AXIS Pipe Jacking Management System...')

  // ==================== Create Users ====================
  const passwordHash = await bcrypt.hash('axis123', 10)

  const topManager = await db.user.upsert({
    where: { email: 'ceo@axis.om' },
    update: {},
    create: {
      email: 'ceo@axis.om',
      password: passwordHash,
      name: 'أحمد البلوشي',
      nameEn: 'Ahmed Al-Balushi',
      phone: '+96891234567',
      role: 'top_management',
      language: 'ar',
    },
  })

  const projectManager = await db.user.upsert({
    where: { email: 'pm@axis.om' },
    update: {},
    create: {
      email: 'pm@axis.om',
      password: passwordHash,
      name: 'خالد الحبسي',
      nameEn: 'Khalid Al-Habsi',
      phone: '+96892345678',
      role: 'project_manager',
      language: 'ar',
    },
  })

  const siteEngineer = await db.user.upsert({
    where: { email: 'engineer@axis.om' },
    update: {},
    create: {
      email: 'engineer@axis.om',
      password: passwordHash,
      name: 'سالم الكندي',
      nameEn: 'Salem Al-Kindi',
      phone: '+96893456789',
      role: 'site_engineer',
      language: 'ar',
    },
  })

  const hseOfficer = await db.user.upsert({
    where: { email: 'hse@axis.om' },
    update: {},
    create: {
      email: 'hse@axis.om',
      password: passwordHash,
      name: 'محمد العبري',
      nameEn: 'Mohammed Al-Abri',
      phone: '+96894567890',
      role: 'hse_officer',
      language: 'ar',
    },
  })

  const foreman = await db.user.upsert({
    where: { email: 'foreman@axis.om' },
    update: {},
    create: {
      email: 'foreman@axis.om',
      password: passwordHash,
      name: 'ناصر الشحي',
      nameEn: 'Nasser Al-Shehhi',
      phone: '+96895678901',
      role: 'foreman',
      language: 'ar',
    },
  })

  const accountant = await db.user.upsert({
    where: { email: 'finance@axis.om' },
    update: {},
    create: {
      email: 'finance@axis.om',
      password: passwordHash,
      name: 'عائشة الرواحية',
      nameEn: 'Aisha Al-Rawahi',
      phone: '+96896789012',
      role: 'accountant',
      language: 'ar',
    },
  })

  console.log('✅ Users created')

  // ==================== Create Projects ====================
  const project1 = await db.project.upsert({
    where: { code: 'AXIS-PJ-001' },
    update: {},
    create: {
      code: 'AXIS-PJ-001',
      name: 'مشروع شبكة الصرف الصحي - الموج',
      client: 'بلدية مسقط',
      location: 'الموج، مسقط',
      contractNumber: 'MCT-2024-0892',
      workType: 'pipe_jacking',
      pipeDiameter: '1200mm',
      totalLength: 850,
      pricePerMeter: 85,
      soilType: 'mixed',
      startDate: new Date('2024-09-15'),
      expectedEnd: new Date('2025-03-30'),
      status: 'in_progress',
      progress: 42,
      managerId: projectManager.id,
      engineerId: siteEngineer.id,
      notes: 'مشروع استراتيجي لتطوير شبكة الصرف في منطقة الموج',
    },
  })

  const project2 = await db.project.upsert({
    where: { code: 'AXIS-MT-002' },
    update: {},
    create: {
      code: 'AXIS-MT-002',
      name: 'مشروع عبور طرق تحت الأرض - صلالة',
      client: 'وزارة النقل',
      location: 'صلالة، ظفار',
      contractNumber: 'MOT-2024-0456',
      workType: 'microtunneling',
      pipeDiameter: '1000mm',
      totalLength: 420,
      pricePerMeter: 92,
      soilType: 'rocky',
      startDate: new Date('2024-11-01'),
      expectedEnd: new Date('2025-02-15'),
      status: 'in_progress',
      progress: 65,
      managerId: projectManager.id,
      engineerId: siteEngineer.id,
      notes: 'عبور تحت طريق رئيسي - يتطلب دقة عالية',
    },
  })

  const project3 = await db.project.upsert({
    where: { code: 'AXIS-HDD-003' },
    update: {},
    create: {
      code: 'AXIS-HDD-003',
      name: 'مشروع تمديد كيبلات - صحار',
      client: 'شركة الكهرباء',
      location: 'صحار، الباطنة',
      contractNumber: 'SEC-2025-0123',
      workType: 'hdd',
      pipeDiameter: '800mm',
      totalLength: 320,
      pricePerMeter: 70,
      soilType: 'soft',
      startDate: new Date('2025-01-10'),
      expectedEnd: new Date('2025-04-30'),
      status: 'in_progress',
      progress: 28,
      managerId: projectManager.id,
      engineerId: siteEngineer.id,
    },
  })

  console.log('✅ Projects created')

  // ==================== Create Drive Lines ====================
  const line1 = await db.driveLine.create({
    data: {
      projectId: project1.id,
      lineNumber: 'L-01',
      startPoint: 'MH-101',
      endPoint: 'MH-105',
      totalLength: 320,
      diameter: '1200mm',
      pipeType: 'pipe',
      soilType: 'mixed',
      depth: 6.5,
      status: 'in_progress',
      completedLength: 180,
      progress: 56.25,
      problems: 'صخور صلبة في المنطقة 180-200م',
    },
  })

  const line2 = await db.driveLine.create({
    data: {
      projectId: project1.id,
      lineNumber: 'L-02',
      startPoint: 'MH-105',
      endPoint: 'MH-110',
      totalLength: 280,
      diameter: '1200mm',
      pipeType: 'pipe',
      soilType: 'soft',
      depth: 5.8,
      status: 'not_started',
      completedLength: 0,
      progress: 0,
    },
  })

  const line3 = await db.driveLine.create({
    data: {
      projectId: project1.id,
      lineNumber: 'L-03',
      startPoint: 'MH-110',
      endPoint: 'MH-115',
      totalLength: 250,
      diameter: '1200mm',
      pipeType: 'pipe',
      soilType: 'hard',
      depth: 7.2,
      status: 'not_started',
      completedLength: 0,
      progress: 0,
    },
  })

  const line4 = await db.driveLine.create({
    data: {
      projectId: project2.id,
      lineNumber: 'L-01',
      startPoint: 'ST-01',
      endPoint: 'ST-04',
      totalLength: 220,
      diameter: '1000mm',
      pipeType: 'sleeve',
      soilType: 'rocky',
      depth: 8.0,
      status: 'in_progress',
      completedLength: 165,
      progress: 75,
    },
  })

  const line5 = await db.driveLine.create({
    data: {
      projectId: project2.id,
      lineNumber: 'L-02',
      startPoint: 'ST-04',
      endPoint: 'ST-08',
      totalLength: 200,
      diameter: '1000mm',
      pipeType: 'sleeve',
      soilType: 'rocky',
      depth: 7.5,
      status: 'completed',
      completedLength: 200,
      progress: 100,
    },
  })

  console.log('✅ Drive lines created')

  // ==================== Create Equipment ====================
  const equipment1 = await db.equipment.create({
    data: {
      projectId: project1.id,
      name: 'ماكينة Pipe Jacking الرئيسية',
      number: 'AXIS-MJ-001',
      type: 'jacking_machine',
      status: 'operational',
      dailyHours: 8.5,
      lastMaintenance: new Date('2025-01-15'),
      nextMaintenance: new Date('2025-02-15'),
    },
  })

  const equipment2 = await db.equipment.create({
    data: {
      projectId: project1.id,
      name: 'رافعة هيدروليكية',
      number: 'AXIS-CR-002',
      type: 'crane',
      status: 'operational',
      dailyHours: 7.0,
      lastMaintenance: new Date('2025-01-20'),
      nextMaintenance: new Date('2025-02-20'),
    },
  })

  const equipment3 = await db.equipment.create({
    data: {
      projectId: project1.id,
      name: 'مضخة هيدروليكية',
      number: 'AXIS-PH-003',
      type: 'pump',
      status: 'maintenance_needed',
      dailyHours: 0,
      breakdowns: JSON.stringify([{ date: '2025-01-25', issue: 'تسرب زيت هيدروليك' }]),
      lastMaintenance: new Date('2024-12-30'),
      nextMaintenance: new Date('2025-01-30'),
    },
  })

  const equipment4 = await db.equipment.create({
    data: {
      projectId: project2.id,
      name: 'ماكينة Microtunneling',
      number: 'AXIS-MT-001',
      type: 'jacking_machine',
      status: 'operational',
      dailyHours: 9.0,
      lastMaintenance: new Date('2025-01-10'),
      nextMaintenance: new Date('2025-02-10'),
    },
  })

  console.log('✅ Equipment created')

  // ==================== Create Daily Reports (last 14 days) ====================
  const today = new Date()
  for (let i = 13; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    date.setHours(0, 0, 0, 0)

    // Skip Fridays (5 in JS where Sunday=0)
    if (date.getDay() === 5) continue

    // Project 1 - Line 1 report
    const prevTotal = 180 - (14 - i) * 5
    const dailyMeters = 4 + Math.floor(Math.random() * 4) // 4-7 meters
    const totalMeters = prevTotal + dailyMeters
    const remainingMeters = Math.max(0, 320 - totalMeters)
    const progressPercent = (totalMeters / 320) * 100
    const dailyRevenue = dailyMeters * 85

    const report = await db.dailyReport.create({
      data: {
        projectId: project1.id,
        driveLineId: line1.id,
        reportDate: date,
        weather: ['sunny', 'cloudy', 'sunny'][Math.floor(Math.random() * 3)],
        workStartTime: '06:30',
        workEndTime: '17:00',
        operatingHours: 8.5,
        stoppageHours: 1.5,
        stoppageReason: i === 5 ? 'صيانة ماكينة' : (i === 2 ? 'أمطار' : null),
        workersCount: 12 + Math.floor(Math.random() * 4),
        attendees: JSON.stringify([
          { name: 'ناصر الشحي', role: 'foreman', in: '06:15', out: '17:10' },
          { name: 'علي المهري', role: 'operator', in: '06:20', out: '17:00' },
          { name: 'حمد الرواحي', role: 'welder', in: '06:30', out: '17:00' },
          { name: 'سعيد العامري', role: 'laborer', in: '06:25', out: '17:05' },
        ]),
        startReading: prevTotal,
        endReading: totalMeters,
        dailyMeters,
        totalMeters,
        remainingMeters,
        progressPercent,
        soilExcavated: 'mixed',
        pipesInstalled: Math.ceil(dailyMeters / 3),
        productionNotes: `تم حفر ${dailyMeters} متر اليوم`,
        problems: i === 5 ? 'تأخر بسبب صيانة المضخة الهيدروليكية' : null,
        dailyRevenue,
        status: 'approved',
        approvedById: projectManager.id,
        approvedAt: date,
        createdById: siteEngineer.id,
      },
    })

    // Safety report for each day
    await db.safetyReport.create({
      data: {
        dailyReportId: report.id,
        projectId: project1.id,
        reportDate: date,
        ppeAvailable: true,
        helmetCheck: true,
        bootsCheck: true,
        glovesCheck: true,
        glassesCheck: true,
        workAreaCheck: true,
        barriersCheck: true,
        shaftCheck: true,
        ventilationCheck: true,
        electricalCheck: true,
        craneCheck: true,
        hydraulicCheck: i === 5 ? false : true,
        fireExtinguishers: true,
        workPermit: true,
        toolboxTalk: true,
        hazards: i === 2 ? JSON.stringify(['أرضية زلقة بسبب الأمطار']) : '[]',
        observations: 'موقع آمن',
        violations: null,
        incidentType: 'none',
        signedBy: 'محمد العبري',
        signedById: hseOfficer.id,
        signedAt: date,
      },
    })

    // Costs for each day
    const laborCost = 850
    const fuelCost = 180
    const maintenanceCost = i === 5 ? 350 : 0
    const transportCost = 80

    await db.cost.create({
      data: {
        projectId: project1.id,
        dailyReportId: report.id,
        date,
        category: 'labor',
        description: 'أجور العمال اليومية',
        amount: laborCost,
        recordedById: accountant.id,
      },
    })
    await db.cost.create({
      data: {
        projectId: project1.id,
        dailyReportId: report.id,
        date,
        category: 'fuel',
        description: 'ديزل للمعدات',
        amount: fuelCost,
        recordedById: accountant.id,
      },
    })
    if (maintenanceCost > 0) {
      await db.cost.create({
        data: {
          projectId: project1.id,
          dailyReportId: report.id,
          date,
          category: 'maintenance',
          description: 'صيانة المضخة الهيدروليكية',
          amount: maintenanceCost,
          recordedById: accountant.id,
        },
      })
    }
    await db.cost.create({
      data: {
        projectId: project1.id,
        dailyReportId: report.id,
        date,
        category: 'transport',
        description: 'نقل العمال',
        amount: transportCost,
        recordedById: accountant.id,
      },
    })

    // Project 2 - Line 1 report (some days)
    if (i % 2 === 0) {
      const prevTotal2 = 165 - (14 - i) * 3
      const dailyMeters2 = 3 + Math.floor(Math.random() * 3)
      const totalMeters2 = prevTotal2 + dailyMeters2
      const remainingMeters2 = Math.max(0, 220 - totalMeters2)
      const progressPercent2 = (totalMeters2 / 220) * 100
      const dailyRevenue2 = dailyMeters2 * 92

      const report2 = await db.dailyReport.create({
        data: {
          projectId: project2.id,
          driveLineId: line4.id,
          reportDate: date,
          weather: 'sunny',
          workStartTime: '06:00',
          workEndTime: '17:30',
          operatingHours: 9.0,
          stoppageHours: 1.0,
          stoppageReason: null,
          workersCount: 10,
          attendees: JSON.stringify([
            { name: 'محمد البوسعيدي', role: 'foreman' },
            { name: 'خميس الجابري', role: 'operator' },
          ]),
          startReading: prevTotal2,
          endReading: totalMeters2,
          dailyMeters: dailyMeters2,
          totalMeters: totalMeters2,
          remainingMeters: remainingMeters2,
          progressPercent: progressPercent2,
          soilExcavated: 'rocky',
          pipesInstalled: Math.ceil(dailyMeters2 / 3),
          productionNotes: `حفر في تربة صخرية - ${dailyMeters2} متر`,
          dailyRevenue: dailyRevenue2,
          status: 'approved',
          approvedById: projectManager.id,
          approvedAt: date,
          createdById: siteEngineer.id,
        },
      })

      await db.safetyReport.create({
        data: {
          dailyReportId: report2.id,
          projectId: project2.id,
          reportDate: date,
          ppeAvailable: true,
          helmetCheck: true,
          bootsCheck: true,
          glovesCheck: true,
          glassesCheck: true,
          workAreaCheck: true,
          barriersCheck: true,
          shaftCheck: true,
          ventilationCheck: true,
          electricalCheck: true,
          craneCheck: true,
          hydraulicCheck: true,
          fireExtinguishers: true,
          workPermit: true,
          toolboxTalk: true,
          observations: 'موقع آمن',
          incidentType: 'none',
          signedBy: 'محمد العبري',
          signedById: hseOfficer.id,
          signedAt: date,
        },
      })
    }
  }

  console.log('✅ Daily reports, safety reports, and costs created')

  // ==================== Create Equipment Maintenance ====================
  await db.equipmentMaintenance.create({
    data: {
      equipmentId: equipment1.id,
      date: new Date('2025-01-15'),
      type: 'routine',
      description: 'صيانة دورية - تغيير الزيوت والفلاتر',
      cost: 250,
      partsUsed: 'زيت هيدروليك، فلتر زيت، فلتر هواء',
      performedById: foreman.id,
    },
  })

  await db.equipmentMaintenance.create({
    data: {
      equipmentId: equipment3.id,
      date: new Date('2025-01-25'),
      type: 'repair',
      description: 'إصلاح تسرب في نظام الهيدروليك',
      cost: 350,
      partsUsed: 'خرطوم هيدروليك، حلقات O-ring',
      performedById: foreman.id,
    },
  })

  console.log('✅ Equipment maintenance created')

  // ==================== Create Notifications ====================
  await db.notification.create({
    data: {
      projectId: project1.id,
      type: 'equipment_breakdown',
      title: 'عطل في المعدة',
      message: 'المضخة الهيدروليكية (AXIS-PH-003) تحتاج صيانة طارئة',
      severity: 'critical',
    },
  })

  await db.notification.create({
    data: {
      projectId: project1.id,
      type: 'low_production',
      title: 'انخفاض الإنتاج',
      message: 'إنتاج مشروع الموج أقل من المعدل المطلوب لهذا الأسبوع',
      severity: 'warning',
    },
  })

  await db.notification.create({
    data: {
      projectId: project2.id,
      type: 'deadline_near',
      title: 'اقتراب موعد التسليم',
      message: 'مشروع صلالة يقترب من تاريخ التسليم المتوقع',
      severity: 'warning',
    },
  })

  await db.notification.create({
    data: {
      type: 'safety_alert',
      title: 'تنبيه سلامة',
      message: 'تم رصد أرضية زلقة في موقع الموج - تم اتخاذ الإجراءات',
      severity: 'info',
    },
  })

  console.log('✅ Notifications created')

  // ==================== Create Finishing for completed line ====================
  await db.finishing.create({
    data: {
      projectId: project2.id,
      driveLineId: line5.id,
      date: new Date('2025-01-10'),
      siteCleaned: true,
      wasteRemoved: true,
      shaftClosed: true,
      siteRestored: true,
      lineHandover: true,
      clientNotes: 'تم التسليم بنجاح - العميل راضٍ عن العمل',
      handoverStatus: 'accepted',
      signedBy: 'سالم الكندي',
      signedById: siteEngineer.id,
      signedAt: new Date('2025-01-12'),
    },
  })

  console.log('✅ Finishing record created')

  console.log('\n🎉 Seeding completed successfully!')
  console.log('\n📋 Login credentials (password: axis123):')
  console.log('  • Top Management:    ceo@axis.om')
  console.log('  • Project Manager:   pm@axis.om')
  console.log('  • Site Engineer:     engineer@axis.om')
  console.log('  • HSE Officer:       hse@axis.om')
  console.log('  • Foreman:           foreman@axis.om')
  console.log('  • Accountant:        finance@axis.om')
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
